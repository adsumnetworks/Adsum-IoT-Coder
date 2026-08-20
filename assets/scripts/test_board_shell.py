#!/usr/bin/env python3
"""
Tests for board_shell.py and modem_trace.py.

These run WITHOUT hardware, which is the point: the completion logic is what makes the tool correct on
Linux and macOS, where nobody on this project has a board plugged in. A fake serial port replays the
exact bytes a real nRF9161 DK sent on 2026-08-19, so the behaviour under test is the behaviour observed.

Run:  python assets/scripts/test_board_shell.py
"""

import io
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import board_shell as bs
import modem_trace as mt


class FakeSerial:
    """
    A serial port that replays scripted bytes.

    Deliberately hands data back in small chunks with gaps, because that is how a real UART behaves and
    it is the case a naive "read once and hope" implementation gets wrong.
    """

    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.written = []

    def read(self, _n):
        return self.chunks.pop(0) if self.chunks else b""

    def write(self, data):
        self.written.append(data)
        return len(data)

    def flush(self):
        pass

    def reset_input_buffer(self):
        pass

    def close(self):
        pass


# Real bytes from the DK, captured while building this tool.
AT_REPLY = b"\nmfw_nrf91x1_2.0.0-77.beta\r\nOK\r\n"
HW_REPLY = b"\n%HWVERSION: nRF9161 LACA ADA\r\nOK\r\n"
ERR_REPLY = b"\nERROR\r\n"
MOSH_REPLY = b"AT+CEREG?\r\n+CEREG: 5,4\r\nOK\r\nmosh:~$ "


class CompletionDetection(unittest.TestCase):
    """The whole design rests on knowing when the board has finished talking."""

    def test_at_client_finishes_on_OK(self):
        # No prompt exists on this firmware. Without AT_DONE every command would burn its full timeout.
        ser = FakeSerial([b"\nmfw_nrf91x1", b"_2.0.0-77.beta\r\n", b"OK\r\n"])
        _, why, _ = bs.read_until_prompt(ser, None, hard_timeout=5, idle_timeout=2)
        self.assertEqual(why, "at-ok")

    def test_at_client_finishes_on_ERROR(self):
        ser = FakeSerial([ERR_REPLY])
        _, why, _ = bs.read_until_prompt(ser, None, hard_timeout=5, idle_timeout=2)
        self.assertEqual(why, "at-ok")

    def test_cme_error_also_completes(self):
        ser = FakeSerial([b"\n+CME ERROR: 30\r\n"])
        _, why, _ = bs.read_until_prompt(ser, None, hard_timeout=5, idle_timeout=2)
        self.assertEqual(why, "at-ok")

    def test_shell_finishes_on_its_prompt(self):
        ser = FakeSerial([MOSH_REPLY])
        _, why, _ = bs.read_until_prompt(ser, bs.compile_prompt(r"mosh:~\$"), hard_timeout=5, idle_timeout=2)
        self.assertEqual(why, "prompt")

    def test_completion_is_fast_not_a_fixed_sleep(self):
        # The bug this tool replaces slept 3 s per command. A reply that arrives at once must cost ~nothing.
        ser = FakeSerial([AT_REPLY])
        _, _, elapsed = bs.read_until_prompt(ser, None, hard_timeout=10, idle_timeout=5)
        self.assertLess(elapsed, 0.5, "completion must be signal-driven, never time-driven")

    def test_silence_reports_timeout_and_never_success(self):
        # A board that says nothing must NOT look like a board that answered with nothing.
        ser = FakeSerial([])
        out, why, _ = bs.read_until_prompt(ser, None, hard_timeout=0.3, idle_timeout=5)
        self.assertEqual(why, "timeout")
        self.assertEqual(out, "")

    def test_partial_output_then_quiet_is_idle_not_timeout(self):
        ser = FakeSerial([b"some output with no terminator\r\n"])
        _, why, _ = bs.read_until_prompt(ser, None, hard_timeout=5, idle_timeout=0.2)
        self.assertEqual(why, "idle")

    def test_a_prompt_inside_output_does_not_end_it_early(self):
        # Only the TAIL is checked, so a shell prompt quoted in the middle of output is not a completion.
        ser = FakeSerial([b"help text mentioning mosh:~$ inside\r\n", b"more output\r\n", b"OK\r\n"])
        out, why, _ = bs.read_until_prompt(ser, bs.compile_prompt(r"mosh:~\$"), hard_timeout=5, idle_timeout=2)
        self.assertEqual(why, "at-ok")
        self.assertIn("more output", out)


class PromptDetection(unittest.TestCase):
    def test_an_at_client_reports_no_prompt_rather_than_guessing(self):
        # Falling back to the prompt union here is what made every AT command time out. Returning None is
        # the honest answer and lets AT_DONE do the work.
        ser = FakeSerial([ERR_REPLY])
        pattern, detected = bs.detect_prompt(ser)
        self.assertIsNone(pattern)
        self.assertIsNone(detected)

    def test_a_shell_prompt_is_learned_from_the_board(self):
        ser = FakeSerial([b"\r\nmosh:~$ "])
        pattern, detected = bs.detect_prompt(ser)
        self.assertEqual(detected, "mosh:~$")
        self.assertTrue(re.search(pattern, "mosh:~$ "))


class OutputCleaning(unittest.TestCase):
    def test_ansi_and_crlf_are_normalised(self):
        self.assertEqual(bs.clean("\x1b[1;32mgreen\x1b[0m\r\ntext\r"), "green\ntext\n")

    def test_the_command_echo_is_removed(self):
        self.assertEqual(bs.strip_echo(MOSH_REPLY.decode(), "AT+CEREG?"), "+CEREG: 5,4\nOK")

    def test_the_answer_survives_when_there_is_no_echo(self):
        self.assertEqual(bs.strip_echo(HW_REPLY.decode(), "AT%HWVERSION"), "%HWVERSION: nRF9161 LACA ADA\nOK")


class CrossPlatform(unittest.TestCase):
    """~95% of users are on Windows, but Omar develops on Linux and the tool must not be Windows-shaped."""

    def test_no_windows_only_apis(self):
        src = io.open(os.path.join(os.path.dirname(__file__), "board_shell.py"), encoding="utf-8").read()
        # Strip the module docstring: it deliberately quotes the Windows-only PowerShell this replaces,
        # and banning a word the prose has to name would make the check unmaintainable.
        code = src.split(chr(34) * 3, 2)[-1]
        for banned in ("System.IO.Ports", "winreg", "msvcrt", "powershell", "cmd.exe"):
            self.assertNotIn(banned, code, f"{banned} would break Linux and macOS")

    def test_busy_port_is_recognised_on_every_os(self):
        # Each OS words this differently. Matching only the Windows string would send Linux and macOS
        # users to the unhelpful generic branch.
        src = io.open(os.path.join(os.path.dirname(__file__), "board_shell.py"), encoding="utf-8").read()
        for token in ("Access is denied", "exclusively lock", "Errno 16", "Resource busy", "Errno 13"):
            self.assertIn(token, src, f"busy-port detection misses {token}")

    def test_linux_permission_case_gets_the_dialout_hint(self):
        src = io.open(os.path.join(os.path.dirname(__file__), "board_shell.py"), encoding="utf-8").read()
        self.assertIn("dialout", src, "the usual Linux cause is group membership, not contention")

    def test_wrappers_isolate_python_user_site(self):
        # CLAUDE.md bug B1: a user-site .pth can break the interpreter. Every wrapper must set this.
        here = os.path.dirname(os.path.abspath(__file__))
        for name in ("board-shell", "modem-trace", "board-shell.bat", "modem-trace.bat"):
            body = io.open(os.path.join(here, name), encoding="utf-8").read()
            self.assertIn("PYTHONNOUSERSITE", body, f"{name} does not isolate user-site packages")

    def test_posix_wrappers_verify_python_actually_runs(self):
        # `command -v python3` matches the Microsoft Store stub on Git Bash and dangling symlinks on
        # minimal Linux images. Both exist and neither works.
        here = os.path.dirname(os.path.abspath(__file__))
        for name in ("board-shell", "modem-trace"):
            body = io.open(os.path.join(here, name), encoding="utf-8").read()
            self.assertIn("import sys", body, f"{name} must execute a probe, not just look for a binary")


class ModemTraceExplanation(unittest.TestCase):
    """The tables that turn a code into an answer."""

    def test_uicc_failure_is_named_as_a_sim_problem(self):
        self.assertIn("SIM", mt.CEREG["90"][0])
        notes = mt.explain(["+CEREG: 5,90"])
        self.assertTrue(any("90" in n for n in notes))

    def test_a_single_radio_mode_is_flagged(self):
        # The real finding from Omar's cellular_mqtt trace: LTE-M on, NB-IoT off.
        notes = mt.explain(["AT%XSYSTEMMODE=1,0,0,0"])
        self.assertTrue(any("LTE-M" in n for n in notes))
        self.assertTrue(any("Only one access technology" in n for n in notes))

    def test_subscribing_is_not_confused_with_never_subscribing(self):
        # AT+CEREG=5 is the subscribe; +CEREG: is the answer. Reporting "never subscribed" when the
        # subscribe is right there in the timeline destroys trust in the whole tool.
        notes = mt.explain(["AT+CEREG=5"])
        self.assertTrue(any("Subscribed" in n for n in notes))
        self.assertFalse(any("never subscribed" in n for n in notes))

    def test_an_lte_lc_app_is_not_accused_of_never_subscribing(self):
        # Reported 2026-08-20: BOTH traces in a session got "the app never subscribed with AT+CEREG=5".
        # MoSh and any lte_lc app subscribe through the modem library, not a literal AT command, so the
        # note was simply wrong -- and the agent talked itself out of trusting the tool rather than
        # reporting the defect. A confident wrong note is worse than no note.
        notes = mt.explain(["AT%XSYSTEMMODE=1,0,0,0", "AT+CFUN=1"])
        self.assertFalse(any("never subscribed" in n for n in notes))
        self.assertTrue(any("lte_lc" in n for n in notes))

    def test_a_capture_with_nothing_in_it_still_says_so(self):
        notes = mt.explain(["%XICCID: 894"])
        self.assertTrue(any("missed the attach" in n for n in notes))

    def test_emm_cause_is_translated(self):
        notes = mt.explain(["+CEER: cause 13"])
        self.assertTrue(any("Roaming not allowed" in n for n in notes))

    def test_mdmev_search_status_is_explained(self):
        notes = mt.explain(["%MDMEV: SEARCH STATUS 1"])
        self.assertTrue(any("started searching" in n for n in notes))

    def test_at_extraction_rejects_binary_noise(self):
        # Scraping a RAW trace produces fragments like these. They must not reach the timeline.
        found = mt.extract_at(b"\x00\x01\xff\xfe" + b"AT+CGMR" + b"\x00\xff" + b"OK")
        self.assertIn("AT+CGMR", found)
        self.assertNotIn("\x00", "".join(found))


if __name__ == "__main__":
    unittest.main(verbosity=2)
