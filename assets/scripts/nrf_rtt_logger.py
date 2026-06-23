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
    print("WARNING: pyserial not installed. Attempting to install automatically...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "pyserial", "--quiet"], check=True)
        import serial.tools.list_ports
        HAS_PYSERIAL = True
        print("Successfully installed pyserial.")
    except Exception as e:
        print(f"WARNING: Failed to install pyserial automatically: {e}")
        HAS_PYSERIAL = False

try:
    import pylink as _pylink_check
    HAS_PYLINK = True
except ImportError:
    HAS_PYLINK = False

def ensure_pylink() -> bool:
    """Auto-install pylink-square if not present. Returns True if available."""
    global HAS_PYLINK
    if HAS_PYLINK:
        return True
    print("INFO: pylink-square not installed. Attempting to install automatically...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "pylink-square", "--quiet"], check=True)
        import pylink  # noqa: F401 — adds to sys.modules cache
        HAS_PYLINK = True
        print("Successfully installed pylink-square.")
        return True
    except Exception as e:
        print(f"WARNING: Failed to install pylink-square automatically: {e}")
        return False


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

def get_device_serial(port_or_serial: str) -> str:
    """Check if input is a COM port and map it to a J-Link serial, otherwise return it as-is."""
    # If it's already a 9-12 digit string, it's a serial number
    if str(port_or_serial).isdigit() and len(str(port_or_serial)) >= 8:
        return port_or_serial
    
    # Try nrfutil mapping first
    try:
        result = subprocess.run(["nrfutil", "device", "list"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in lines:
                if port_or_serial in line:
                    parts = line.split()
                    if len(parts) >= 2:
                        if port_or_serial in parts[0] or parts[0] in port_or_serial:
                            if parts[1].isdigit() and len(parts[1]) >= 8:
                                return parts[1]
    except Exception:
        pass

    # Try pyserial COM port HWID inference if installed
    if HAS_PYSERIAL:
        try:
            ports = serial.tools.list_ports.comports()
            for p in ports:
                if p.device == port_or_serial:
                    if p.serial_number:
                        return p.serial_number.lstrip('0')
                    # Extract from HWID (USB VID:PID=... SER=123456...)
                    if 'SER=' in p.hwid:
                        serial_num = p.hwid.split('SER=')[1].split()[0]
                        return serial_num.lstrip('0')
        except Exception:
            pass
            
    # If all fails, just return what they gave us and let J-Link tools throw the final error
    return port_or_serial

def reset_device(port_or_serial: str) -> bool:
    """Reset device using nrfutil (preferred) or nrfjprog."""
    resolved_serial = get_device_serial(port_or_serial)
    serial_str = str(resolved_serial).lstrip('0')

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
# Monitor Thread (pylink dual-channel: ch0 = text log, ch1 = BT Monitor binary)
# ============================================================================

class MonitorRTTThread(threading.Thread):
    """Reads RTT channel 0 (text) and channel 1 (BT Monitor binary) via pylink-square.

    Channel 0 → timestamped lines → .log file (same format as RTTLoggerThread).
    Channel 1 → raw BT Monitor frames → .btmon file (decoded by the Adsum viewer).
    """

    def __init__(self, name: str, serial: str, final_file: str, btmon_file: str, device_type: str):
        super().__init__(daemon=True)
        self.name = name
        self.serial = serial
        self.final_file = final_file
        self.btmon_file = btmon_file
        self.device_type = device_type
        self.running = True
        self.line_count = 0
        self.btmon_bytes = 0
        self.attached = False

    def stop(self):
        self.running = False

    def run(self):
        import pylink  # available after ensure_pylink()

        jlink = None
        try:
            jlink = pylink.JLink()
            jlink.open(serial_no=int(self.serial))
            jlink.set_tif(pylink.enums.JLinkInterfaces.SWD)
            jlink.set_speed(4000)
            jlink.connect(self.device_type, verbose=False)
            jlink.rtt_start(None)
            self.attached = True
        except Exception as e:
            print(f"  [{self.name}] pylink connect failed: {e}")
            if jlink:
                try: jlink.close()
                except: pass
            return

        buf0 = bytearray()
        try:
            with open(self.final_file, 'w', encoding='utf-8') as log_f, \
                 open(self.btmon_file, 'wb') as btmon_f:
                log_f.write(f"# RTT Log from {self.name} ({self.serial})\n")
                log_f.write(f"# Started: {datetime.now().isoformat()}\n")
                log_f.write(f"# Interface: SWD, Speed: 4000 kHz, Channel: 0\n")
                log_f.write("-" * 60 + "\n")

                while self.running:
                    # Channel 0 — text log lines
                    try:
                        chunk = bytes(jlink.rtt_read(0, 4096))
                        if chunk:
                            buf0.extend(chunk)
                            while b'\n' in buf0:
                                nl = buf0.index(b'\n')
                                line = buf0[:nl + 1].decode('utf-8', errors='replace')
                                buf0 = buf0[nl + 1:]
                                ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                                log_f.write(f"[{ts}] {line}")
                                log_f.flush()
                                self.line_count += 1
                    except Exception:
                        pass

                    # Channel 1 — raw BT Monitor binary frames
                    try:
                        chunk = bytes(jlink.rtt_read(1, 4096))
                        if chunk:
                            btmon_f.write(chunk)
                            btmon_f.flush()
                            self.btmon_bytes += len(chunk)
                    except Exception:
                        pass

                    time.sleep(0.02)  # 50 Hz poll

        except Exception as e:
            print(f"  [{self.name}] Monitor error: {e}")
        finally:
            try:
                jlink.rtt_stop()
                jlink.close()
            except Exception:
                pass


# ============================================================================
# Capture Orchestration
# ============================================================================

def capture_rtt_logs(devices, duration, output_dir, reset=True, device_type=DEFAULT_DEVICE_TYPE, channel=DEFAULT_RTT_CHANNEL, monitor=False):
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    kill_jlink_processes()

    if reset:
        print(f"  Resetting {len(devices)} device(s)...")
        for name, serial in devices.items():
            reset_device(serial)

    log_dir = output_dir
    os.makedirs(log_dir, exist_ok=True)
    started = []  # (mode, name, proc_or_None, thread, raw_or_None, final_file, btmon_or_None)

    if monitor and not ensure_pylink():
        print("  WARNING: pylink-square unavailable — falling back to single-channel (no .btmon).")
        monitor = False

    if monitor:
        for name, raw_serial_or_port in devices.items():
            serial = get_device_serial(raw_serial_or_port)
            role = name if name in ["central", "peripheral"] else "device"
            final_file = os.path.join(log_dir, f"{role}_{serial}_{timestamp}.log")
            btmon_file = os.path.join(log_dir, f"{role}_{serial}_{timestamp}.btmon")
            thread = MonitorRTTThread(name, serial, final_file, btmon_file, device_type)
            thread.start()
            started.append(("monitor", name, None, thread, None, final_file, btmon_file))
    else:
        try:
            jlink_exe = find_jlink_rtt_logger()
        except FileNotFoundError as e:
            print(f"  ERROR: {e}")
            return {}

        for name, raw_serial_or_port in devices.items():
            serial = get_device_serial(raw_serial_or_port)
            role = name if name in ["central", "peripheral"] else "device"
            final_file = os.path.join(log_dir, f"{role}_{serial}_{timestamp}.log")
            raw_file = os.path.join(log_dir, f"{role}_{serial}_{timestamp}_raw.log")
            cmd = [jlink_exe, "-Device", device_type, "-If", "SWD", "-Speed", "4000",
                   "-USB", str(serial), "-RTTChannel", str(channel), raw_file]
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                active_processes.append(proc)
                thread = RTTLoggerThread(name, serial, proc, raw_file, final_file)
                thread.start()
                started.append(("rtt", name, proc, thread, raw_file, final_file, None))
            except Exception as e:
                print(f"  [{name}] Failed to start: {e}")

    if not started:
        return {}

    print(f"\n  Capturing for {duration} seconds... (Ctrl+C to stop)")
    try:
        for i in range(duration, 0, -1):
            total_lines = sum(t.line_count for _, n, p, t, r, f, b in started)
            if monitor:
                btmon_kb = sum(t.btmon_bytes for _, n, p, t, r, f, b in started) // 1024
                sys.stdout.write(f"\r  [{i:3d}s] Lines: {total_lines}  HCI: {btmon_kb} KB ")
            else:
                sys.stdout.write(f"\r  [{i:3d}s] Lines: {total_lines} ")
            sys.stdout.flush()
            time.sleep(1)
        print("\r  Capture complete!                        ")
    except KeyboardInterrupt:
        print("\n  Interrupted.")

    print("\n  Processing logs...")
    result = {}
    for _, name, proc, thread, raw, final, btmon in started:
        thread.stop()
        if proc and proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=1)
            except: proc.kill()
        thread.join(timeout=2)

        if os.path.exists(final):
            size = os.path.getsize(final)
            print(f"    [{name}] {os.path.basename(final)} ({size} bytes, {thread.line_count} lines)")
        if btmon and os.path.exists(btmon):
            bsize = os.path.getsize(btmon)
            print(f"    [{name}] {os.path.basename(btmon)} ({bsize} bytes, HCI monitor)")
        if raw and os.path.exists(raw):
            os.remove(raw)
        result[name] = final

    return result


def analyze_logs(log_files):
    """Enhanced analysis of log files with BLE event tracking and timeline."""
    print("\n[ANALYSIS] Scanning logs for key patterns...")
    
    # BLE Event Patterns
    patterns = {
        "boot": ["*** Booting", "Zephyr OS", "ncs", "main()"],
        "errors": ["[ERR]", "Error", "FAULT", "assert", "panic", "HardFault", "BusFault"],
        "warnings": ["[WRN]", "Warning"],
        "ble_adv": ["Advertising successfully started", "Advertising started", "adv_data"],
        "ble_conn": ["Connected", "Security changed", "Le Connected"],
        "ble_disc": ["Disconnected", "Le Disconnected", "Terminated"],
        "ble_scan": ["Scanning started", "Device found"],
        "ble_data": ["Notification enabled", "Value:", "Data received"],
        "mtu": ["MTU exchange", "MTU updated"]
    }
    
    # Error Code Map (Common Zephyr/BLE codes)
    error_codes = {
        "0x08": "Timeout",
        "0x13": "Remote User Terminated Connection",
        "0x16": "Local Host Terminated Connection",
        "0x3d": "MIC Failure (Decryption Error)",
        "-116": "ETIMEDOUT",
        "-128": "ENOTCONN"
    }
    
    events = []
    
    for log_file in log_files:
        filename = os.path.basename(log_file)
        print(f"\n  File: {filename}")
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                
            print(f"    Total lines: {len(lines)}")
            
            # Pattern Matching
            stats = {k: 0 for k in patterns}
            
            for line in lines:
                # Track statistics
                for category, keywords in patterns.items():
                    if any(kw.lower() in line.lower() for kw in keywords):
                        stats[category] += 1
                        
                # Extract Timeline Events
                # RTT logs often have timestamp at start: "00> [00:00:00.123,456] <inf> ..."
                timestamp = ""
                if "]" in line and "[" in line:
                     try:
                        timestamp = line.split(']')[0].split('[')[-1].strip()
                     except:
                        pass
                
                # Check for specific notable events to add to timeline
                if any(kw in line for kw in ["Connected", "Disconnected", "Booting", "Advertising", "Error", "FAULT"]):
                    events.append({
                        "time": timestamp,
                        "file": filename,
                        "event": line.strip()
                    })
                    
                # Check for error codes
                for code, desc in error_codes.items():
                    if code in line:
                         events.append({
                            "time": timestamp,
                            "file": filename,
                            "event": f"⚠️ ERROR CODE {code}: {desc}"
                        })

            # Print Statistics
            for category, count in stats.items():
                if count > 0:
                    print(f"    {category.upper()}: {count} matches")
                    
        except Exception as e:
            print(f"    ERROR reading file: {e}")

    # Generate Timeline Summary
    if events:
        print("\n[TIMELINE] Key Events across all devices:")
        print("-" * 80)
        # Sort by timestamp if possible
        try:
            events.sort(key=lambda x: x["time"])
        except:
             pass 
             
        for e in events:
            # Format: [Time] [File] Event
            print(f"  [{e['time']:<12}] {e['file'][:15]:<15} | {e['event']}")
        print("-" * 80)
        print("Tip: Use these timestamps to correlate interactions between Central and Peripheral.")


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
    parser.add_argument("--reset-serials", help="Device serial numbers to reset (comma-separated)")
    parser.add_argument("--analyze", action="store_true", help="Analyze logs after recording")
    parser.add_argument("--channel", type=int, default=DEFAULT_RTT_CHANNEL)
    parser.add_argument("--device-type", type=str, default=DEFAULT_DEVICE_TYPE)
    parser.add_argument("--monitor", action="store_true",
                        help="Dual-channel capture: text log (.log) + HCI binary (.btmon). "
                             "Requires CONFIG_BT_DEBUG_MONITOR_RTT=y on device and pylink-square.")

    args = parser.parse_args()
    
    if args.list:
        serials = list_jlink_devices()
        print("\nConnected J-Link Devices:")
        if not serials:
            print("  No devices found.")
        for s in serials:
            print(f"  {s}")
        return

    # Parse devices
    devices = {}
    if args.devices:
        for item in args.devices.split(","):
            if ":" in item or "=" in item:
                # Support name:serial or name=serial
                sep = ":" if ":" in item else "="
                name, serial = item.split(sep, 1)
                devices[name.strip()] = serial.strip()
            else:
                print(f"ERROR: Invalid device format '{item}'. Use name:serial")
                sys.exit(1)
    elif args.port:
        devices["device"] = args.port
    else:
        # Auto-detect if requested
        if args.auto_detect:
            print("[AUTO] Detecting connected J-Link devices...")
            jlink_devices = list_jlink_devices()
            if not jlink_devices:
                print("ERROR: No J-Link devices found.")
                sys.exit(1)
            
            for i, serial in enumerate(jlink_devices):
                name = f"device{i+1}"
                devices[name] = serial
                print(f"  - Auto-assigned {name}: {serial}")
        else:
             print("ERROR: Specify --port, --devices, or --auto-detect")
             parser.print_help()
             sys.exit(1)

    # Capture
    log_files = capture_rtt_logs(devices, args.duration, args.output, reset=not args.no_reset, device_type=args.device_type, channel=args.channel, monitor=args.monitor)
    
    # Analyze
    if args.analyze and log_files:
        # Convert map values to list
        file_list = list(log_files.values()) if isinstance(log_files, dict) else log_files
        if file_list:
            analyze_logs(file_list)

if __name__ == "__main__":
    main()
