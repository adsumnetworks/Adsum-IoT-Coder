#!/usr/bin/env python3
"""
nrf_logger.py - Cross-platform UART/RTT Logging Tool for Nordic nRF Devices

Features:
- Multi-device simultaneous logging
- Pre-flight connection test
- Automatic device reset before capture
- Timestamped log files
- Cross-platform (Windows/Mac/Linux)

Usage:
    # List available ports
    python nrf_logger.py --list

    # Test connection (2 sec)
    python nrf_logger.py --test --port /dev/ttyACM0

    # Record from single device
    python nrf_logger.py --port /dev/ttyACM0 --duration 60 --output logs/

    # Multi-device recording with reset
    python nrf_logger.py --devices central:/dev/ttyACM0,peripheral:/dev/ttyACM1 \
                         --duration 60 --reset-serials 683007782,683247800 --output logs/
"""

import argparse
import os
import sys
import signal
import subprocess
import threading
import time
from datetime import datetime

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


def reset_device(serial_number):
    """Reset device using nrfjprog."""
    print(f"[RESET] Resetting device {serial_number}...")
    try:
        result = subprocess.run(
            ["nrfjprog", "--reset", "-s", str(serial_number)],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print(f"[RESET] Device {serial_number} reset successfully")
            return True
        else:
            print(f"[ERROR] Reset failed: {result.stderr}")
            return False
    except FileNotFoundError:
        print("[ERROR] nrfjprog not found. Is nRF Command Line Tools installed?")
        return False
    except subprocess.TimeoutExpired:
        print("[ERROR] Reset command timed out")
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
        self.error = None
        
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
                stopbits=serial.STOPBITS_ONE
            )
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


def record_logs(devices, duration, output_dir, reset_serials=None):
    """Record logs from multiple devices simultaneously."""
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    print(f"\n[RECORD] Starting {duration}s recording to {output_dir}/")
    
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
    time.sleep(0.3)  # Give time for serial connections to establish
    
    # PHASE 2: Reset devices AFTER loggers are running
    if reset_serials:
        print("\n[PHASE 2] Resetting devices (loggers already capturing)...")
        for sn in reset_serials:
            reset_device(sn)
        print("  Boot logs should now be captured!")
    
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
        epilog=__doc__
    )
    
    parser.add_argument("--list", action="store_true", help="List available serial ports")
    parser.add_argument("--test", action="store_true", help="Test connection (2-5 sec capture)")
    parser.add_argument("--port", help="Serial port (e.g., /dev/ttyACM0, COM3)")
    parser.add_argument("--name", default="device", help="Device name for log file (default: device)")
    parser.add_argument("--devices", help="Multi-device: name1:port1,name2:port2")
    parser.add_argument("--baudrate", type=int, default=DEFAULT_BAUDRATE, help=f"Baud rate (default: {DEFAULT_BAUDRATE})")
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION, help=f"Recording duration in seconds (default: {DEFAULT_DURATION})")
    parser.add_argument("--output", default="logs", help="Output directory (default: logs/)")
    parser.add_argument("--reset-serials", help="Device serial numbers to reset (comma-separated)")
    parser.add_argument("--analyze", action="store_true", help="Analyze logs after recording")
    
    args = parser.parse_args()
    
    # List ports
    if args.list:
        list_ports()
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
    
    # Parse reset serials
    reset_serials = []
    if args.reset_serials:
        reset_serials = [s.strip() for s in args.reset_serials.split(",")]
    
    # Record logs
    log_files = record_logs(devices, args.duration, args.output, reset_serials)
    
    # Analyze if requested
    if args.analyze and log_files:
        analyze_logs(log_files)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
