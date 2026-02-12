#!/usr/bin/env python3
"""
nRF RTT Logger - Real-Time Transfer logging for Nordic devices with Real-time Timestamps
"""

import argparse
import atexit
import os
import signal
import subprocess
import sys
import time
import threading
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Tuple

try:
    import serial.tools.list_ports
    HAS_PYSERIAL = True
except ImportError:
    HAS_PYSERIAL = False



# ============================================================================
# Constants
# ============================================================================

DEFAULT_DEVICE_TYPE = "NRF52840_XXAA"
DEFAULT_INTERFACE = "SWD"
DEFAULT_SPEED = 4000
DEFAULT_RTT_CHANNEL = 0
DEFAULT_DURATION = 30

# Track active processes for cleanup
active_processes: List[subprocess.Popen] = []


# ============================================================================
# Binary Path Resolution
# ============================================================================

def find_jlink_rtt_logger() -> str:
    """Find JLinkRTTLogger executable on the system.
    
    Returns:
        Path to JLinkRTTLogger or raises error if not found.
    """
    is_windows = sys.platform == "win32"
    exe_name = "JLinkRTTLogger.exe" if is_windows else "JLinkRTTLogger"
    
    # Try to find via PATH first
    found = shutil.which(exe_name)
    if found:
        return found
    
    # On Windows, search common J-Link installation directories (including versioned ones)
    if is_windows:
        import glob
        common_paths = [
            r"C:\Program Files\SEGGER\JLink\JLinkRTTLogger.exe",
            r"C:\Program Files (x86)\SEGGER\JLink\JLinkRTTLogger.exe",
            # Also search for versioned installations like JLink_V876
            r"C:\Program Files\SEGGER\JLink_V*\JLinkRTTLogger.exe",
            r"C:\Program Files (x86)\SEGGER\JLink_V*\JLinkRTTLogger.exe",
            os.path.expandvars(r"%ProgramFiles%\SEGGER\JLink\JLinkRTTLogger.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\SEGGER\JLink\JLinkRTTLogger.exe"),
            os.path.expandvars(r"%ProgramFiles%\SEGGER\JLink_V*\JLinkRTTLogger.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\SEGGER\JLink_V*\JLinkRTTLogger.exe"),
            # nRF Command Line Tools installation  
            os.path.expandvars(r"%ProgramFiles%\Nordic Semiconductor\nrf-command-line-tools\bin\JLinkRTTLogger.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Nordic Semiconductor\nrf-command-line-tools\bin\JLinkRTTLogger.exe"),
            # nRF Connect SDK toolchain
            os.path.expandvars(r"%LocalAppData%\ncs\toolchains\v*\bin\JLinkRTTLogger.exe"),
        ]
        
        for path_pattern in common_paths:
            if "*" in path_pattern:
                # Handle glob patterns
                matches = glob.glob(path_pattern)
                for match in matches:
                    if os.path.exists(match):
                        return match
            elif os.path.exists(path_pattern):
                return path_pattern
    else:
        # On macOS/Linux, also check common installation paths
        common_paths = [
            "/usr/local/bin/JLinkRTTLogger",
            "/opt/SEGGER/JLink/JLinkRTTLogger",
            "/Applications/SEGGER/JLink_*/JLinkRTTLogger",
        ]
        for path_pattern in common_paths:
            if "*" in path_pattern:
                import glob
                matches = glob.glob(path_pattern)
                for match in matches:
                    if os.path.exists(match):
                        return match
            elif os.path.exists(path_pattern):
                return path_pattern
    
    # Not found - provide helpful error with download link
    raise FileNotFoundError(
        f"{exe_name} not found in PATH or common installation directories.\n"
        "\nTo enable RTT logging:\n"
        "1. Download J-Link Software Pack from:\n"
        "   https://www.segger.com/downloads/jlink/\n"
        "2. Run the installer and follow the prompts\n"
        "3. Ensure J-Link installation is added to your PATH\n"
        "\nOr set the J-Link path explicitly:\n"
        "   export PATH=/path/to/jlink:$PATH  (Linux/macOS)\n"
        "   set PATH=C:\\path\\to\\jlink;%PATH%  (Windows)"
    )


# ============================================================================
# Cleanup Handlers
# ============================================================================

def kill_jlink_processes():
    """Kill any existing J-Link processes to prevent locks. Cross-platform."""
    is_windows = sys.platform == "win32"
    processes_to_kill = ["JLinkRTTLogger", "nrfjprog", "JLinkExe", "JLinkGDBServer"]
    
    try:
        for proc_name in processes_to_kill:
            try:
                if is_windows:
                    # Windows: use taskkill
                    subprocess.run(
                        ["taskkill", "/F", "/IM", f"{proc_name}.exe"],
                        capture_output=True,
                        timeout=5
                    )
                else:
                    # Unix: use pkill
                    subprocess.run(
                        ["pkill", "-9", proc_name],
                        capture_output=True,
                        timeout=5
                    )
            except Exception:
                # Process might not exist or command failed - that's OK
                pass
        time.sleep(0.5)
    except Exception:
        # Non-fatal if cleanup fails
        pass


def cleanup_processes():
    for proc in active_processes:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except:
                proc.kill()
    kill_jlink_processes()


def signal_handler(signum, frame):
    cleanup_processes()
    sys.exit(0)


atexit.register(cleanup_processes)
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


# ============================================================================
# Device Discovery
# ============================================================================

def list_jlink_devices() -> List[str]:
    """List J-Link devices using nrfutil (preferred) or nrfjprog."""
    devices = []
    # Try nrfutil first
    try:
        result = subprocess.run(["nrfutil", "device", "list"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in lines:
                parts = line.split()
                if len(parts) >= 2 and (len(parts[1]) == 9 or len(parts[1]) == 12): # Basic SN validation
                     devices.append(parts[1])
            if devices: return devices
    except:
        pass

    # Fallback: Try pyserial to find J-Link CDC ports
    if not devices and HAS_PYSERIAL:
        try:
            ports = serial.tools.list_ports.comports()
            for p in ports:
                # Common Nordic/J-Link identifiers
                if "JLink" in p.description or "SEGGER" in p.description or "1366" in p.hwid:
                    # Extract serial from object or HWID
                    sn = getattr(p, 'serial_number', None)
                    if not sn and "SER=" in p.hwid:
                        sn = p.hwid.split("SER=")[1].split()[0]
                    
                    if sn and sn not in devices:
                        devices.append(sn)
        except:
            pass
            
    return devices

def reset_device(serial_number: str) -> bool:
    """Reset device using nrfutil (preferred) or nrfjprog."""
    serial_str = str(serial_number).lstrip('0') or str(serial_number)
    
    nrfutil_error = None
    
    # Try nrfutil first
    try:
        result = subprocess.run(["nrfutil", "device", "reset", "--serial-number", serial_str], capture_output=True, text=True, timeout=10)
        if result.returncode == 0: return True
        nrfutil_error = result.stderr.strip() or "Unknown nrfutil error"
    except FileNotFoundError:
        pass # nrfutil not installed
    except Exception as e:
        nrfutil_error = str(e)

    # Fallback to nrfjprog
    try:
        result = subprocess.run(["nrfjprog", "--reset", "-s", serial_str], capture_output=True, text=True, timeout=10)
        if result.returncode == 0: return True
        # If both failed, show nrfutil error if it existed (since it's preferred)
        if nrfutil_error:
             print(f"[WARNING] Device {serial_str} reset failed (nrfutil): {nrfutil_error}")
        else:
             print(f"[WARNING] Device {serial_str} reset failed (nrfjprog): {result.stderr.strip()}")
        return False
    except FileNotFoundError:
        if nrfutil_error:
             print(f"[WARNING] Device {serial_str} reset failed: {nrfutil_error}")
        else:
             print("[WARNING] neither nrfutil nor nrfjprog found. Reset skipped.")
        return False
    except Exception as e:
        print(f"[WARNING] Reset error: {e}")
        return False


# ============================================================================
# RTT Logger Thread
# ============================================================================

class RTTLoggerThread(threading.Thread):
    """Thread to read from JLinkRTTLogger raw file and add timestamps."""
    def __init__(self, name: str, serial: str, process: subprocess.Popen, raw_file: str, final_file: str):
        super().__init__()
        self.name = name
        self.serial = serial
        self.process = process
        self.raw_file = raw_file
        self.final_file = final_file
        self.running = True
        self.line_count = 0
        self.attached = False
        
    def stop(self):
        self.running = False
        
    def run(self):
        # Wait for file to be created by JLinkRTTLogger (signifies attachment)
        start_wait = time.time()
        raw_handle = None
        while self.running and not raw_handle and (time.time() - start_wait < 15):
            if os.path.exists(self.raw_file):
                try:
                    raw_handle = open(self.raw_file, 'r', encoding='utf-8', errors='replace')
                    self.attached = True
                    break
                except:
                    pass
            if self.process.poll() is not None:
                break
            time.sleep(0.1)
            
        if not raw_handle:
            return

        try:
            with open(self.final_file, 'w', encoding='utf-8') as f:
                f.write(f"# RTT Log from {self.name} ({self.serial})\n")
                f.write(f"# Started: {datetime.now().isoformat()}\n")
                f.write(f"# Interface: SWD, Speed: 4000 kHz, Channel: 0\n")
                f.write("-" * 60 + "\n")
                
                while self.running:
                    line = raw_handle.readline()
                    if not line:
                        if self.process.poll() is not None:
                            # Final read
                            line = raw_handle.readline()
                            if not line: break
                        time.sleep(0.05)
                        continue
                    
                    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    f.write(f"[{timestamp}] {line}")
                    f.flush()
                    self.line_count += 1
        except:
            pass
        finally:
            raw_handle.close()


# ============================================================================
# Capture Orchestration
# ============================================================================

def capture_rtt_logs(devices, duration, output_dir, reset=True, device_type=DEFAULT_DEVICE_TYPE, channel=DEFAULT_RTT_CHANNEL):
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    kill_jlink_processes()
    
    if reset:
        print(f"  Resetting {len(devices)} device(s)...")
        for name, serial in devices:
            reset_device(serial)
    
    started = []
    # Find JLinkRTTLogger executable once
    try:
        jlink_exe = find_jlink_rtt_logger()
    except FileNotFoundError as e:
        print(f"  ERROR: {e}")
        return {}
    
    for name, serial in devices:
        final_file = os.path.abspath(os.path.join(output_dir, f"rtt_{name}_{timestamp}.log"))
        raw_file = final_file + ".raw"
        
        cmd = [jlink_exe, "-Device", device_type, "-If", "SWD", "-Speed", "4000", "-USB", str(serial), "-RTTChannel", str(channel), raw_file]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            active_processes.append(proc)
            thread = RTTLoggerThread(name, serial, proc, raw_file, final_file)
            thread.start()
            started.append((name, proc, thread, raw_file, final_file))
        except Exception as e:
            print(f"  [{name}] Failed to start: {e}")

    if not started: return {}

    print(f"\n  Capturing for {duration} seconds... (Ctrl+C to stop)")
    try:
        for i in range(duration, 0, -1):
            total_lines = sum(t.line_count for n, p, t, r, f in started)
            sys.stdout.write(f"\r  [{i:3d}s] Lines: {total_lines} ")
            sys.stdout.flush()
            time.sleep(1)
        print("\r  Capture complete!                 ")
    except KeyboardInterrupt:
        print("\n  Interrupted.")

    print("\n  Processing logs...")
    for name, proc, thread, raw, final in started:
        thread.stop()
        if proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=1)
            except: proc.kill()
        thread.join(timeout=2)
        
        if os.path.exists(final):
            size = os.path.getsize(final)
            print(f"    [{name}] {os.path.basename(final)} ({size} bytes, {thread.line_count} lines)")
        
        if os.path.exists(raw):
            os.remove(raw)
            
    return {n: f for n, p, t, r, f in started}


def main():
    parser = argparse.ArgumentParser(description="nRF RTT Logger")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--capture", action="store_true")
    parser.add_argument("--auto-detect", action="store_true")
    parser.add_argument("--devices", type=str)
    parser.add_argument("--port", type=str)
    parser.add_argument("--name", type=str, default="device")
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION)
    parser.add_argument("--output", type=str, default="logs")
    parser.add_argument("--no-reset", action="store_true")
    parser.add_argument("--channel", type=int, default=DEFAULT_RTT_CHANNEL)
    parser.add_argument("--device-type", type=str, default=DEFAULT_DEVICE_TYPE)
    
    args = parser.parse_args()
    
    if args.list:
        serials = list_jlink_devices()
        print("\nConnected J-Link Devices:")
        for s in sorted(serials): print(f"  {s}")
        return

    if args.capture:
        if args.devices:
            devices = []
            for d in args.devices.split(','):
                if ':' in d:
                    n, s = d.split(':', 1)
                    devices.append((n.strip(), s.strip()))
                else:
                    devices.append((d.strip(), d.strip()))
        elif args.port:
            devices = [(args.name, args.port)]
        elif args.auto_detect:
            serials = list_jlink_devices()
            devices = [(f"device_{i}", s) for i, s in enumerate(sorted(serials))]
        else:
            return

        capture_rtt_logs(devices, args.duration, args.output, not args.no_reset, args.device_type, args.channel)

if __name__ == "__main__":
    main()
