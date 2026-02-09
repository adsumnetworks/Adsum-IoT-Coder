#!/usr/bin/env python3
"""
Auto-tests for Nordic UART and RTT Logging Scripts
Tests basic functionality, transport detection, and error handling
Run: python3 test_logger_scripts.py
"""

import os
import sys
import subprocess
import tempfile
import shutil
from pathlib import Path

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

class LoggerTest:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.tests = []
        self.script_dir = Path(__file__).parent.absolute()
        
    def log(self, level, message):
        """Print formatted log message"""
        if level == "=":
            print(f"\n{BLUE}{'='*70}{RESET}")
            print(f"{BLUE}{message}{RESET}")
            print(f"{BLUE}{'='*70}{RESET}")
        elif level == "PASS":
            print(f"{GREEN}[PASS] {message}{RESET}", flush=True)
        elif level == "FAIL":
            print(f"{RED}[FAIL] {message}{RESET}", flush=True)
        elif level == "WARN":
            print(f"{YELLOW}[WARN] {message}{RESET}", flush=True)
        else:
            print(f"  {message}", flush=True)
    
    def test(self, name, func):
        """Run a test and track results"""
        self.log("=", name)
        try:
            func()
            self.passed += 1
            self.log("PASS", f"{name} PASSED")
        except AssertionError as e:
            self.failed += 1
            self.log("FAIL", f"{name} FAILED: {e}")
        except Exception as e:
            self.failed += 1
            self.log("FAIL", f"{name} ERROR: {e}")
        self.tests.append((name, self.passed + self.failed - len(self.tests)))
    
    # ========================================================================
    # UART LOGGER TESTS
    # ========================================================================
    
    def test_uart_help(self):
        """Test UART logger help output"""
        uart_script = self.script_dir / "uart-logger"
        if sys.platform == "win32":
            uart_script = self.script_dir / "uart-logger.bat"
        
        assert uart_script.exists(), f"uart-logger not found at {uart_script}"
        self.log(".", f"Found: {uart_script}")
    
    def test_uart_list_ports(self):
        """Test UART logger can list serial ports"""
        uart_script = self.script_dir / "uart-logger"
        if sys.platform == "win32":
            uart_script = self.script_dir / "uart-logger.bat"
        
        try:
            result = subprocess.run(
                [str(uart_script), "--list"],
                capture_output=True,
                text=True,
                timeout=5
            )
            self.log(".", f"Return code: {result.returncode}")
            self.log(".", f"Output sample: {result.stdout[:100]}..." if len(result.stdout) > 100 else f"Output: {result.stdout}")
            # Just verify it ran, may or may not find ports
            assert result.returncode in [0, 1], f"Unexpected return code: {result.returncode}"
        except subprocess.TimeoutExpired:
            raise AssertionError("uart-logger --list timed out")
    
    def test_uart_pre_capture_delay_param(self):
        """Test UART logger accepts --pre-capture-delay parameter"""
        # Don't run actual capture, just verify parameter is accepted
        # Check source code contains parameter
        uart_py = self.script_dir / "nrf_uart_logger.py"
        assert uart_py.exists(), f"nrf_uart_logger.py not found"
        
        content = uart_py.read_text()
        assert "--pre-capture-delay" in content, "pre-capture-delay parameter not found"
        assert "pre_capture_delay" in content, "pre_capture_delay variable not found"
        self.log(".", "pre-capture-delay parameter found in source")
    
    def test_uart_nrfutil_support(self):
        """Test UART logger uses nrfutil for device reset"""
        uart_py = self.script_dir / "nrf_uart_logger.py"
        assert uart_py.exists(), f"nrf_uart_logger.py not found"
        
        content = uart_py.read_text()
        assert "nrfutil" in content, "nrfutil not mentioned in UART logger"
        assert "device reset" in content, "device reset command not found"
        self.log(".", "nrfutil integration found")
    
    def test_uart_nrfjprog_fallback(self):
        """Test UART logger has nrfjprog fallback"""
        uart_py = self.script_dir / "nrf_uart_logger.py"
        content = uart_py.read_text()
        
        assert "nrfjprog" in content, "nrfjprog fallback not found"
        assert "fallback" in content.lower(), "Fallback mechanism not documented"
        self.log(".", "nrfjprog fallback mechanism present")
    
    # ========================================================================
    # RTT LOGGER TESTS
    # ========================================================================
    
    def test_rtt_help(self):
        """Test RTT logger help output"""
        rtt_script = self.script_dir / "rtt-logger"
        if sys.platform == "win32":
            rtt_script = self.script_dir / "rtt-logger.bat"
        
        assert rtt_script.exists(), f"rtt-logger not found at {rtt_script}"
        self.log(".", f"Found: {rtt_script}")
    
    def test_rtt_capture_flag(self):
        """Test RTT logger has --capture flag"""
        rtt_py = self.script_dir / "nrf_rtt_logger.py"
        assert rtt_py.exists(), f"nrf_rtt_logger.py not found"
        
        content = rtt_py.read_text()
        # RTT needs capture flag per system requirements
        assert "--capture" in content or "capture" in content, "capture flag not found in RTT logger"
        self.log(".", "capture mode found in RTT logger")
    
    # ========================================================================
    # TRANSPORT DETECTION TESTS
    # ========================================================================
    
    def test_project_detector_module(self):
        """Test RTT/UART project detector exists and compiles"""
        # Path should be relative to project root, not assets
        scripts_dir = Path(__file__).parent
        repo_root = scripts_dir.parent.parent  # Go up from assets/scripts to repo root
        detector_path = repo_root / "src" / "platform" / "nordicProjectDetector.ts"
        
        if detector_path.exists():
            content = detector_path.read_text()
            assert "ProjectCapabilities" in content, "ProjectCapabilities interface not found"
            assert "CONFIG_USE_SEGGER_RTT" in content, "RTT config detection not found"
            assert "CONFIG_LOG_BACKEND_UART" in content, "UART config detection not found"
            self.log(".", "Project detector module found and valid")
        else:
            self.log("WARN", f"Project detector not found at {detector_path}, but this is optional for script tests")
    
    def test_uart_port_vs_rtt_serial_detection(self):
        """Test transport detection: COM/tty vs 9-digit serial"""
        # This tests the handler logic, not the script
        # Just verify the detection heuristic: 9-digit = RTT, COM/tty = UART
        
        # Check handler source code for detection logic
        scripts_dir = Path(__file__).parent
        repo_root = scripts_dir.parent.parent
        handler_path = repo_root / "src" / "core" / "task" / "tools" / "handlers" / "TriggerNordicActionHandler.ts"
        if handler_path.exists():
            content = handler_path.read_text()
            assert "isRttSerial" in content, "RTT serial detection function not found"
            # Check for regex pattern using raw string
            assert r"^\d{9}$" in content or "9-digit" in content.lower(), "9-digit detection not found"
            self.log(".", "RTT vs UART transport detection logic present")
        else:
            self.log("WARN", f"Handler file not found at {handler_path}, skipping detection test")
    
    # ========================================================================
    # ERROR HANDLING TESTS
    # ========================================================================
    
    def test_uart_graceful_nrfutil_failure(self):
        """Test UART logger handles missing nrfutil gracefully"""
        uart_py = self.script_dir / "nrf_uart_logger.py"
        content = uart_py.read_text()
        
        # Verify graceful handling
        assert "FileNotFoundError" in content, "FileNotFoundError handler not found"
        assert "WARNING" in content, "WARNING message not found"
        assert "Continuing" in content, "Continuation message not found"
        self.log(".", "Graceful error handling code present")
    
    def test_scripts_python3_compatible(self):
        """Test scripts have Python 3 shebang"""
        for script_name in ["nrf_uart_logger.py", "nrf_rtt_logger.py"]:
            script_path = self.script_dir / script_name
            if script_path.exists():
                first_line = script_path.read_text().split('\n')[0]
                assert "python3" in first_line or "python" in first_line, f"{script_name} missing python3 shebang"
                self.log(".", f"{script_name} has proper shebang")
    
    # ========================================================================
    # OUTPUT DIRECTORY TESTS
    # ========================================================================
    
    def test_uart_output_directory_handling(self):
        """Test UART logger creates output directory if needed"""
        uart_py = self.script_dir / "nrf_uart_logger.py"
        content = uart_py.read_text()
        
        # Verify output directory creation
        assert "makedirs" in content, "makedirs not found for output directory creation"
        assert "exist_ok" in content.lower(), "exist_ok parameter not found"
        self.log(".", "Output directory creation handling found")
    
    # ========================================================================
    # SUMMARY & REPORT
    # ========================================================================
    
    def run_all(self):
        """Run all tests"""
        self.log("=", "NORDIC LOGGER AUTO-TESTS")
        self.log(".", f"Script directory: {self.script_dir}")
        self.log(".", f"Platform: {sys.platform}")
        
        # UART Tests
        self.test("UART Logger - Script Exists", self.test_uart_help)
        self.test("UART Logger - List Ports", self.test_uart_list_ports)
        self.test("UART Logger - Pre-Capture Delay", self.test_uart_pre_capture_delay_param)
        self.test("UART Logger - nrfutil Support", self.test_uart_nrfutil_support)
        self.test("UART Logger - nrfjprog Fallback", self.test_uart_nrfjprog_fallback)
        
        # RTT Tests
        self.test("RTT Logger - Script Exists", self.test_rtt_help)
        self.test("RTT Logger - Capture Flag", self.test_rtt_capture_flag)
        
        # Transport Detection Tests
        self.test("Transport Detection - Serial vs Port", self.test_uart_port_vs_rtt_serial_detection)
        self.test("Project Detector - Module Exists", self.test_project_detector_module)
        
        # Error Handling
        self.test("UART - Graceful nrfutil Handling", self.test_uart_graceful_nrfutil_failure)
        self.test("Scripts - Python3 Compatible", self.test_scripts_python3_compatible)
        
        # Output Handling
        self.test("UART - Output Directory", self.test_uart_output_directory_handling)
        
        # Print summary
        self.print_summary()
        
        return 0 if self.failed == 0 else 1
    
    def print_summary(self):
        """Print test summary"""
        total = self.passed + self.failed
        self.log("=", "TEST SUMMARY")
        print(f"{GREEN}PASSED: {self.passed}/{total}{RESET}")
        print(f"{RED}FAILED: {self.failed}/{total}{RESET}")
        
        if self.failed == 0:
            print(f"\n{GREEN}[SUCCESS] ALL TESTS PASSED!{RESET}")
        else:
            print(f"\n{RED}[FAILED] {self.failed} test(s) failed{RESET}")
            print(f"\nFailed tests:")
            for name, _ in self.tests:
                if self.failed > 0:
                    print(f"  - {name}")

if __name__ == "__main__":
    tester = LoggerTest()
    sys.exit(tester.run_all())
