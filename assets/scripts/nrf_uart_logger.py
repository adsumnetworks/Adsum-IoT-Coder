#!/usr/bin/env python3
"""
nrf_uart_logger.py - Cross-platform UART Logging Tool for Nordic nRF Devices

Features:
- Multi-device simultaneous logging
- Pre-flight connection test
- Automatic device reset before capture
- Timestamped log files
- Cross-platform (Windows/Mac/Linux)

Usage:
    # List available ports
    python nrf_uart_logger.py --list

    # Test connection (2 sec)
    python nrf_uart_logger.py --test --port /dev/ttyACM0

    # Record from single device
    python nrf_uart_logger.py --port /dev/ttyACM0 --duration 60 --output logs/

    # Multi-device recording with reset
    python nrf_logger.py --devices central:/dev/ttyACM0,peripheral:/dev/ttyACM1 \
                         --duration 60 --reset-serials 683007782,683247800 --output logs/
"""

import argparse
import atexit
import os
import sys
import signal
import subprocess
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("ERROR: pyserial not installed. Run: pip install pyserial")
    sys.exit(1)




# Default settings
DEFAULT_BAUDRATE = 115200
DEFAULT_TIMEOUT = 1.0
DEFAULT_DURATION = 30

# Track active processes for cleanup
active_processes = []


# ============================================================================
# Cross-platform Process Cleanup
# ============================================================================

def kill_jlink_processes():
    """Kill any existing J-Link/nrfjprog processes to prevent locks. Cross-platform."""
    is_windows = sys.platform == "win32"
    processes_to_kill = ["nrfjprog", "JLinkExe", "JLinkGDBServer"]
    
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
    except Exception:
        # Non-fatal if cleanup fails
        pass


def cleanup_processes():
    """Cleanup active processes."""
    kill_jlink_processes()
    for proc in active_processes:
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=1)
            except:
                try:
                    proc.kill()
                except:
                    pass


def signal_handler(signum, frame):
    """Handle signals gracefully."""
    cleanup_processes()
    sys.exit(0)


# Register cleanup handlers
atexit.register(cleanup_processes)
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (AttributeError, ValueError):
    # Some signals might not be available on all platforms
    pass


def list_ports():
    """List all available serial ports."""
    ports = serial.tools.list_ports.comports()
    if not ports:
        print("No serial ports found.")
        return []
    
    print("\nAvailable Serial Ports:")
    print("-" * 60)
    for port in ports:
        print(f"  {port.device}")
        print(f"    Description: {port.description}")
        print(f"    Hardware ID: {port.hwid}")
        print()
    return [p.device for p in ports]


def list_nrf_devices():
    """List ONLY nRF devices and return list of (port, serial)."""
    devices = []
    
    # Try nrfutil first (modern standard)
    try:
        # Use --json for machine-readable output if supported, but standard table is more common in current versions
        result = subprocess.run(
            ["nrfutil", "device", "list"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0 and result.stdout.strip():
            # Basic parsing of nrfutil table output
            lines = result.stdout.strip().split('\n')
            for line in lines:
                if 'tty' in line or 'COM' in line:
                    parts = line.split()
                    # Expecting format: identifier serial_number ...
                    if len(parts) >= 2:
                        port = parts[0]
                        sn = parts[1]
                        devices.append((port, sn))
            
            if devices:
                print(f"[INFO] Found {len(devices)} nRF devices via nrfutil")
                return devices
        
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[INFO] nrfutil error: {e}")
    
    # Fallback: Try pyserial list_ports to find J-Link CDC ports
    try:
        ports = serial.tools.list_ports.comports()
        for p in ports:
            # Common Nordic/J-Link identifiers
            if "JLink" in p.description or "SEGGER" in p.description:
                sn = p.serial_number or get_device_serial(p.device) or "0"
                devices.append((p.device, sn))
    except Exception as e:
        print(f"[ERROR] listing devices via pyserial: {e}")
    
    return devices


def auto_detect_devices():
    """Auto-detect all connected nRF devices for BLE development."""
    nrf_devices = list_nrf_devices()
    if not nrf_devices:
        return {}, []
    
    # Create device map with automatic naming
    device_map = {}
    if len(nrf_devices) >= 2:
        # Sort by port to have consistent naming
        nrf_devices.sort() 
        # BLE scenario: likely central + peripheral
        device_map["central"] = nrf_devices[0][0]
        device_map["peripheral"] = nrf_devices[1][0]
        for i, (port, _) in enumerate(nrf_devices[2:], start=3):
            device_map[f"device_{i}"] = port
    else:
        # Single device
        device_map["device"] = nrf_devices[0][0]
    
    return device_map, [sn for _, sn in nrf_devices]


def test_connection(port, baudrate=DEFAULT_BAUDRATE, duration=2):
    """Test serial connection and capture brief output."""
    print(f"\n[TEST] Testing connection to {port} at {baudrate} baud for {duration}s...")
    
    try:
        ser = serial.Serial(
            port=port,
            baudrate=baudrate,
            timeout=DEFAULT_TIMEOUT,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE
        )
    except serial.SerialException as e:
        print(f"[ERROR] Cannot open {port}: {e}")
        return False, ""
    
    output_lines = []
    start_time = time.time()
    
    try:
        while (time.time() - start_time) < duration:
            if ser.in_waiting:
                line = ser.readline().decode('utf-8', errors='replace').strip()
                if line:
                    output_lines.append(line)
                    print(f"  > {line}")
    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
    
    if output_lines:
        print(f"\n[SUCCESS] Received {len(output_lines)} lines from {port}")
        return True, "\n".join(output_lines)
    else:
        print(f"\n[WARNING] No data received from {port}")
        print("  - Check if device is connected and powered")
        print("  - Try unplugging and replugging USB")
        print("  - Verify CONFIG_LOG_BACKEND_UART=y in prj.conf")
        return False, ""


def get_device_serial(port):
    """Get J-Link serial number from port."""
    try:
        ports = serial.tools.list_ports.comports()
        for p in ports:
            if p.device == port:
                # Extract serial from hardware ID (format: USB VID:PID=... SER=123456...)
                if 'SER=' in p.hwid:
                    serial_num = p.hwid.split('SER=')[1].split()[0]
                    return serial_num.lstrip('0')  # Strip leading zeros for nrfjprog
                # Try serial_number attribute
                if hasattr(p, 'serial_number') and p.serial_number:
                    return p.serial_number.lstrip('0')
        return None
    except Exception as e:
        print(f"[WARNING] Could not detect serial for {port}: {e}")
        return None


def reset_device(serial_number):
    """Reset device using nrfutil (modern) with nrfjprog as fallback (legacy).
    
    nrfutil: Modern standard (recommended)
    nrfjprog: Legacy fallback for older development setups
    """
    serial_str = str(serial_number).lstrip('0')
    print(f"[RESET] Resetting device {serial_str}...")
    
    # Try nrfutil first (modern standard)
    try:
        result = subprocess.run(
            ["nrfutil", "device", "reset", "--serial-number", serial_str],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print(f"[RESET] Device {serial_number} reset successfully (via nrfutil)")
            return True
        nrfutil_error = result.stderr.strip() or "Unknown error"
    except FileNotFoundError:
        pass # nrfutil not installed
    except Exception as e:
        nrfutil_error = str(e)
    
    # Fallback: Try nrfjprog (legacy)
    try:
        result = subprocess.run(
            ["nrfjprog", "--reset", "-s", serial_str],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print(f"[RESET] Device {serial_number} reset successfully (via nrfjprog)")
            return True
        else:
            if nrfutil_error:
                print(f"[WARNING] Reset failed (nrfutil): {nrfutil_error}")
            else:
                print(f"[WARNING] nrfjprog reset also failed: {result.stderr}")
            return False
    except Exception as e:
        if nrfutil_error:
             print(f"[WARNING] Reset failed: {nrfutil_error}")
        else:
             print(f"[WARNING] Reset error: {e}. Continuing without reset.")
        return False


class DeviceLogger(threading.Thread):
    """Thread to log from a single device."""
    
    def __init__(self, name, port, baudrate, output_dir, duration):
        super().__init__()
        self.name = name
        self.port = port
        self.baudrate = baudrate
        self.output_dir = output_dir
        self.duration = duration
        self.running = True
        self.line_count = 0
        self.error = ""
        
        # Create timestamped filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = os.path.join(output_dir, f"{name}_{timestamp}.log")
    
    def stop(self):
        self.running = False
    
    def run(self):
        try:
            ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=0.5,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                rtscts=False,
                dsrdtr=False
            )
            # FORCE DTR/RTS active (crucial for some boards to output logs)
            ser.dtr = True
            ser.rts = True
        except serial.SerialException as e:
            self.error = f"Cannot open {self.port}: {e}"
            return
        
        start_time = time.time()
        
        try:
            with open(self.filename, 'w', encoding='utf-8') as f:
                # Write header
                f.write(f"# Log from {self.name} ({self.port})\n")
                f.write(f"# Started: {datetime.now().isoformat()}\n")
                f.write(f"# Baudrate: {self.baudrate}\n")
                f.write(f"# Settings: DTR=True, RTS=True\n")
                f.write(f"# Started: {datetime.now().isoformat()}\n")
                f.write(f"# Baudrate: {self.baudrate}\n")
                f.write("-" * 60 + "\n")
                f.flush()
                
                while self.running and (time.time() - start_time) < self.duration:
                    if ser.in_waiting:
                        try:
                            line = ser.readline().decode('utf-8', errors='replace')
                            if line:
                                timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                                f.write(f"[{timestamp}] {line}")
                                f.flush()
                                self.line_count += 1
                        except Exception as e:
                            f.write(f"[ERROR] Read error: {e}\n")
                                
        except Exception as e:
            self.error = str(e)
        finally:
            ser.close()


def record_logs(devices, duration, output_dir, reset_serials=None, pre_capture_delay=0):
    """Record logs from multiple devices simultaneously.
    
    Args:
        devices: Dict of {name: port} for devices to capture from
        duration: Recording duration in seconds
        output_dir: Directory to save logs
        reset_serials: List of device serial numbers to reset
        pre_capture_delay: Extra delay before reset (in seconds) to ensure loggers are ready
    """
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    print(f"\n[RECORD] [UART MODE] Starting {duration}s recording to {output_dir}/")
    if pre_capture_delay > 0:
        print(f"[PRE-CAPTURE] Pre-capture delay enabled: {pre_capture_delay}s")
    
    # PHASE 1: Start loggers FIRST (before reset to capture boot logs)
    print("\n[PHASE 1] Starting log capture FIRST (to catch boot logs)...")
    loggers = []
    for name, port in devices.items():
        logger = DeviceLogger(
            name=name,
            port=port,
            baudrate=DEFAULT_BAUDRATE,
            output_dir=output_dir,
            duration=duration
        )
        logger.start()
        loggers.append(logger)
        print(f"  - {name}: {port} -> {logger.filename}")
    
    # Wait for serial ports to be fully open and ready
    stabilization_delay = 0.3  # Give time for serial connections to establish
    total_pre_delay = stabilization_delay + pre_capture_delay
    
    if total_pre_delay > 0:
        print(f"\n[PHASE 1B] Waiting {total_pre_delay}s for ports to stabilize...")
        for remaining in range(int(total_pre_delay), 0, -1):
            print(f"  {remaining}s...", end='\r', flush=True)
            time.sleep(1)
        print("  Ready! Starting reset...                 ")
    else:
        time.sleep(stabilization_delay)
    
    # PHASE 2: Reset devices AFTER loggers are running
    if reset_serials:
        print("\n[PHASE 2] Resetting devices (loggers already capturing)...")
        for sn in reset_serials:
            reset_device(sn)
        print("  Boot logs should now be captured!")
    else:
        print("\n[PHASE 2] No reset serials provided. Capturing runtime logs.")
    
    # Wait for completion
    print(f"\n[RECORDING] Capturing for {duration} seconds... (Ctrl+C to stop early)")
    try:
        start = time.time()
        while (time.time() - start) < duration:
            time.sleep(1)
            elapsed = int(time.time() - start)
            total_lines = sum(l.line_count for l in loggers)
            print(f"\r  [{elapsed}/{duration}s] Lines captured: {total_lines}", end="", flush=True)
    except KeyboardInterrupt:
        print("\n\n[STOPPED] Recording interrupted by user")
    
    # Stop all loggers
    for logger in loggers:
        logger.stop()
    for logger in loggers:
        logger.join(timeout=2)
    
    # Report results
    print("\n\n[COMPLETE] Recording finished!")
    print("-" * 60)
    for logger in loggers:
        if logger.error:
            print(f"  {logger.name}: ERROR - {logger.error}")
        else:
            print(f"  {logger.name}: {logger.line_count} lines -> {logger.filename}")
    print("-" * 60)
    
    return [l.filename for l in loggers if not l.error]


def analyze_logs(log_files):
    """Basic analysis of log files."""
    print("\n[ANALYSIS] Scanning logs for key patterns...")
    
    patterns = {
        "boot": ["*** Booting", "Zephyr OS", "ncs", "main()"],
        "errors": ["[ERR]", "Error", "FAULT", "assert", "panic"],
        "warnings": ["[WRN]", "Warning"],
        "ble": ["BT", "Bluetooth", "advertising", "connected", "disconnected"],
        "data": ["sensor", "temp", "data", "value"]
    }
    
    for log_file in log_files:
        print(f"\n  File: {os.path.basename(log_file)}")
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                
            print(f"    Total lines: {len(lines)}")
            
            for category, keywords in patterns.items():
                matches = sum(1 for line in lines if any(kw.lower() in line.lower() for kw in keywords))
                if matches > 0:
                    print(f"    {category.upper()}: {matches} matches")
                    
        except Exception as e:
            print(f"    ERROR reading file: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="nRF UART Logger - Cross-platform serial logging tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
nRF UART Logger - Cross-platform serial logging tool
Usage:
    python nrf_uart_logger.py --list
    python nrf_uart_logger.py --test --port COM3
    python nrf_uart_logger.py --capture --port COM3 --duration 30
"""
    )
    
    parser.add_argument("--list", action="store_true", help="List available serial ports")
    parser.add_argument("--list-nrf", action="store_true", help="List only nRF devices (using nrfjprog)")
    parser.add_argument("--auto-detect", action="store_true", help="Auto-detect all nRF devices for BLE recording")
    parser.add_argument("--test", action="store_true", help="Test connection (2-5 sec capture)")
    parser.add_argument("--capture", action="store_true", help="Capture logs from device(s)")
    parser.add_argument("--port", help="Serial port (e.g., /dev/ttyACM0, COM3)")
    parser.add_argument("--name", default="device", help="Device name for log file (default: device)")
    parser.add_argument("--devices", help="Multi-device: name1:port1,name2:port2")
    parser.add_argument("--baudrate", type=int, default=DEFAULT_BAUDRATE, help=f"Baud rate (default: {DEFAULT_BAUDRATE})")
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION, help=f"Recording duration in seconds (default: {DEFAULT_DURATION})")
    parser.add_argument("--output", default="logs", help="Output directory (default: logs/)")
    parser.add_argument("--reset", action="store_true", help="Reset device(s) before capture (DEFAULT for boot logs)")
    parser.add_argument("--no-reset", action="store_true", help="Skip reset (for mid-runtime capture)")
    parser.add_argument("--reset-serials", help="Device serial numbers to reset (comma-separated, auto-detected if not provided)")
    parser.add_argument("--pre-capture-delay", type=int, default=0, help="Extra delay before reset in seconds (default: 0, recommended: 2-3 for boot logs)")
    parser.add_argument("--analyze", action="store_true", help="Analyze logs after recording")
    
    args = parser.parse_args()
    
    # List ports
    if args.list:
        list_ports()
        return 0
    
    # List nRF devices only
    if args.list_nrf:
        list_nrf_devices()
        return 0
    
    # Auto-detect for BLE development
    if args.auto_detect:
        device_map, serials = auto_detect_devices()
        if not device_map:
            print("ERROR: No nRF devices found for auto-detection")
            return 1
        print(f"\n[AUTO-DETECT] Found {len(device_map)} device(s) for BLE recording:")
        for name, port in device_map.items():
            print(f"  - {name}: {port}")
        
        # Use auto-detected devices
        devices = device_map
        reset_serials = serials if not args.no_reset else []
        
        # Record logs
        log_files = record_logs(devices, args.duration, args.output, reset_serials, args.pre_capture_delay)
        
        # Analyze if requested
        if args.analyze and log_files:
            analyze_logs(log_files)
        
        return 0
    
    # Test connection
    if args.test:
        if not args.port:
            print("ERROR: --port required for test mode")
            return 1
        success, _ = test_connection(args.port, args.baudrate, duration=2)
        return 0 if success else 1
    
    # Parse devices
    devices = {}
    if args.devices:
        for item in args.devices.split(","):
            if ":" in item:
                name, port = item.split(":", 1)
                devices[name.strip()] = port.strip()
            else:
                print(f"ERROR: Invalid device format '{item}'. Use name:port")
                return 1
    elif args.port:
        devices[args.name] = args.port
    else:
        print("ERROR: Specify --port or --devices")
        parser.print_help()
        return 1
    
    # Determine if we should reset (DEFAULT: yes, unless --no-reset)
    should_reset = not args.no_reset  # Default is True
    if args.reset:
        should_reset = True  # Explicit --reset overrides
    
    # Parse or auto-detect reset serials
    reset_serials = []
    if should_reset:
        if args.reset_serials:
            # Explicit serial numbers provided
            reset_serials = [s.strip() for s in args.reset_serials.split(",")]
        else:
            # Auto-detect from ports
            print("[AUTO-DETECT] Attempting to detect device serial numbers...")
            for name, port in devices.items():
                serial = get_device_serial(port)
                if serial:
                    print(f"  - {name} ({port}): Serial {serial}")
                    reset_serials.append(serial)
                else:
                    print(f"  - {name} ({port}): Could not detect serial (reset will be skipped for this device)")
            
            if not reset_serials:
                print("[WARNING] Could not auto-detect any serial numbers. Reset disabled.")
                print("  Tip: Provide --reset-serials manually for reliable reset.")
    
    # Record logs
    log_files = record_logs(devices, args.duration, args.output, reset_serials, args.pre_capture_delay)
    
    # Analyze if requested
    if args.analyze and log_files:
        analyze_logs(log_files)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
