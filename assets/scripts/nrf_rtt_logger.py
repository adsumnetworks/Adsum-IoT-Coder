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
from datetime import datetime
from typing import Dict, List, Optional, Tuple

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
# Cleanup Handlers
# ============================================================================

def kill_jlink_processes():
    """Kill any existing J-Link processes to prevent locks."""
    try:
        subprocess.run(["pkill", "-9", "JLinkRTTLogger"], capture_output=True)
        subprocess.run(["pkill", "-9", "nrfjprog"], capture_output=True)
        subprocess.run(["pkill", "-9", "JLinkExe"], capture_output=True)
        subprocess.run(["pkill", "-9", "JLinkGDBServer"], capture_output=True)
        time.sleep(0.5)
    except Exception:
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
    try:
        result = subprocess.run(["nrfjprog", "--ids"], capture_output=True, text=True, timeout=5)
        if result.returncode != 0: return []
        return [s.strip() for s in result.stdout.strip().split('\n') if s.strip()]
    except:
        return []

def reset_device(serial_number: str) -> bool:
    serial_str = str(serial_number).lstrip('0') or str(serial_number)
    try:
        result = subprocess.run(["nrfjprog", "--reset", "-s", serial_str], capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except:
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
    for name, serial in devices:
        final_file = os.path.abspath(os.path.join(output_dir, f"rtt_{name}_{timestamp}.log"))
        raw_file = final_file + ".raw"
        
        cmd = ["JLinkRTTLogger", "-Device", device_type, "-If", "SWD", "-Speed", "4000", "-USB", str(serial), "-RTTChannel", str(channel), raw_file]
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
    parser.add_argument("--output", type=str, default="./rtt_logs")
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
