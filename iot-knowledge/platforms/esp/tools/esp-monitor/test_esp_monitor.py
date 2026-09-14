#!/usr/bin/env python3
"""
A monitor capture reads the board; it resets only when asked.

2026-09-14: an nRF capture of a board nobody had confirmed began "[RESET] Device … reset successfully",
and its output was then read as evidence about the developer's board. This monitor had the same default
(reset unless --no-reset), and `idf.py monitor` itself resets on connect by toggling DTR/RTS unless it is
given --no-reset together with a port.

Run: python3 -m unittest discover -s iot-knowledge/platforms/esp/tools/esp-monitor -p 'test_*.py'
"""
import importlib.util
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
MONITOR = os.path.join(HERE, "esp_monitor_logger.py")


def load(name):
    spec = importlib.util.spec_from_file_location(name, MONITOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class MonitorNeverResetsUnlessAsked(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _main_no_reset(self, argv):
        mod = load("esp_monitor_main")
        seen = {}

        def capture_one(device, duration, output, no_reset, chip, baud, concurrent):
            seen["no_reset"] = no_reset
            return ""

        mod.capture_one = capture_one
        old = sys.argv
        sys.argv = ["esp_monitor_logger.py", "--port", "/dev/ttyUSB0", "--duration", "1", "--output", self.tmp] + argv
        try:
            with redirect_stdout(io.StringIO()):
                mod.main()
        finally:
            sys.argv = old
        return seen["no_reset"]

    def _capture(self, no_reset, port, log_text=""):
        """Run capture_one with the capture paths stubbed; return the calls it made and what it printed."""
        mod = load("esp_monitor_capture")
        calls = []
        log_path = os.path.join(self.tmp, "board.log")

        def fake_capture(*args):
            calls.append(args)
            with open(log_path, "w", encoding="utf-8") as fh:
                fh.write(log_text)
            return True

        mod.find_usb_serial_port = lambda: None
        mod.resolve_chip = lambda project, chip: "esp32"
        mod.build_log_path = lambda output, label, chip, port: log_path
        mod.is_built_idf_project = lambda project: False
        mod.capture_raw_serial = fake_capture
        mod.capture_via_idf_monitor = fake_capture
        out = io.StringIO()
        with redirect_stdout(out):
            mod.capture_one({"name": None, "port": port, "project": None}, 1, self.tmp, no_reset, None, 115200, False)
        return calls, out.getvalue()

    def test_plain_capture_does_not_reset(self):
        self.assertTrue(self._main_no_reset([]), "a monitor capture with no flag must not reset the board")

    def test_reset_is_an_opt_in(self):
        self.assertFalse(self._main_no_reset(["--reset"]))

    def test_no_reset_wins(self):
        self.assertTrue(self._main_no_reset(["--reset", "--no-reset"]))

    def test_idf_monitor_gets_no_reset_and_the_port(self):
        mod = load("esp_monitor_cmd")
        mod.resolve_idf_py_argv = lambda: ["idf.py"]
        cmd = mod.build_monitor_cmd("/proj", "/dev/ttyUSB0", True)
        self.assertIn("--no-reset", cmd)
        self.assertIn("-p", cmd, "idf.py monitor --no-reset only holds the reset when a port is given")

    def test_no_port_means_no_capture_rather_than_a_reset(self):
        calls, printed = self._capture(no_reset=True, port=None)
        self.assertEqual(calls, [], "without a port the monitor would reset the board, so nothing may run")
        self.assertIn("Pass --port", printed)

    def test_bootloader_is_not_reset_out_of_without_asking(self):
        calls, printed = self._capture(
            no_reset=True, port="/dev/ttyUSB0", log_text="rst:0x10 (RTCWDT_RTC_RESET),boot:0x3 (DOWNLOAD_BOOT)\nwaiting for download\n"
        )
        self.assertEqual(len(calls), 1, "one capture, no reset-and-recapture")
        self.assertIn("Not resetting it", printed)


if __name__ == "__main__":
    unittest.main()
