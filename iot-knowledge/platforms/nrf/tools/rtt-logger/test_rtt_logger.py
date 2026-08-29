#!/usr/bin/env python3
"""
The two ways these loggers used to mislead a reader, pinned.

2026-08-29: `rtt-logger --out /tmp/x/rtt_probe.log` created a DIRECTORY with that name and left it empty,
and a capture that saw nothing printed a friendly summary and exited 0. Both were read as "the console is
silent" and sent an agent forty messages into a firmware theory. The board was fine both times.

Run: python3 -m unittest discover -s iot-knowledge -p 'test_*.py'
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
RTT = os.path.join(HERE, "nrf_rtt_logger.py")
UART = os.path.join(TOOLS, "uart-logger", "nrf_uart_logger.py")


def load(path, name):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class OutNeverCreatesADirectory(unittest.TestCase):
    """
    THE INCIDENT. TOOL.md documented `--out <FILE>`; the parser defined only `--output <DIR>`; argparse
    prefix matching accepted one as the other, and os.makedirs made a directory named rtt_probe.log.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _out_is_a_file_or_refused(self, tool):
        target = os.path.join(self.tmp, "probe.log")
        src = os.path.join(self.tmp, "captured.log")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write("one line\n")
        mod = load(tool, os.path.basename(tool).replace(".py", ""))
        mod.honour_out_file(target, [src])
        self.assertTrue(os.path.isfile(target), f"{tool}: --out must produce a FILE")
        self.assertFalse(os.path.isdir(target), f"{tool}: --out must never produce a directory")

    def test_rtt_out_is_a_file(self):
        self._out_is_a_file_or_refused(RTT)

    def test_uart_out_is_a_file(self):
        self._out_is_a_file_or_refused(UART)

    def test_prefix_matching_is_off_so_a_typo_is_refused_not_reinterpreted(self):
        # --outp should NOT silently become --output. Being told the flag is wrong is the whole point.
        r = subprocess.run(
            [sys.executable, RTT, "--capture", "--port", "/dev/null", "--outp", self.tmp],
            capture_output=True, text=True, timeout=60,
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unrecognized arguments", (r.stderr + r.stdout))

    def test_out_refuses_to_overwrite_an_existing_directory(self):
        target = os.path.join(self.tmp, "already-a-dir")
        os.makedirs(target)
        src = os.path.join(self.tmp, "captured.log")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write("x\n")
        mod = load(RTT, "rtt_for_dir_test")
        mod.honour_out_file(target, [src])
        self.assertTrue(os.path.isdir(target), "an existing directory is left alone, with a warning")
        self.assertTrue(os.path.isfile(src), "and the capture is not lost")


class ZeroCaptureIsReported(unittest.TestCase):
    """
    A capture that saw nothing printed `0 lines -> file` and exited 0, which reads as success. It has to
    say what it means, and it has to be symmetric: the capture saw nothing is NOT the board printed
    nothing, and the wording must not claim the second.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.log = os.path.join(self.tmp, "empty.log")
        open(self.log, "w", encoding="utf-8").close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _check(self, tool, name):
        mod = load(tool, name)
        code = mod.report_zero_capture([("device", self.log)], 30)
        self.assertEqual(code, 1, "a capture that saw nothing must not read as success")
        with open(self.log, encoding="utf-8") as fh:
            written = fh.read()
        self.assertIn("0 lines captured", written, "the reason belongs in the artefact, not only on stdout")
        self.assertIn("does NOT say the board printed nothing", written, "the message must stay symmetric")
        self.assertEqual(mod.report_zero_capture([], 30), 0, "a capture that saw something is still a pass")

    def test_rtt_says_what_it_means(self):
        self._check(RTT, "rtt_zero")

    def test_uart_says_what_it_means(self):
        self._check(UART, "uart_zero")


if __name__ == "__main__":
    unittest.main()
