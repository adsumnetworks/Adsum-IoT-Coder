#!/usr/bin/env python3
"""
board_shell.py - send commands to a board's interactive shell and read the answers.

WHY THIS EXISTS
---------------
Every logger in this folder is READ-ONLY: it opens the port and calls readline() forever. There was no
write path anywhere in the product, so an agent that needed to ask the modem a question had nothing to
reach for. On 2026-08-19 one hand-rolled this instead:

    $p = New-Object System.IO.Ports.SerialPort COM18,115200,None,8,One
    $p.Write($c + "`r"); Start-Sleep -Seconds 3

That works, on Windows, slowly. It is Windows-only (System.IO.Ports is .NET), it pays a flat 3 seconds
per command however fast the board answered, and a command slower than the sleep is silently truncated.

This script replaces it with one mechanism that behaves the same on Windows, Linux and macOS.

THE DESIGN POINT: READ UNTIL THE PROMPT, NEVER SLEEP
----------------------------------------------------
A Zephyr shell prints its prompt when it is ready for the next command. That is a far better completion
signal than a stopwatch. We send, then read until the prompt comes back. A command that answers in 40 ms
costs 40 ms; a command that legitimately takes three minutes (AT+COPS=?) still gets its full timeout
instead of being cut off at 3 seconds.

Commands are batched into ONE port session, so N commands cost one open/close, not N.

USAGE
-----
    board_shell.py --list-ports
    board_shell.py --port COM18 --cmd "AT+CEREG?" --cmd "AT+CSQ"
    board_shell.py --port /dev/ttyACM0 --at --cmd "AT+CEREG?"       # modem shell: prefixes "at "
    board_shell.py --port COM18 --script diagnose.txt --json
    board_shell.py --port COM18 --cmd "AT+COPS=?" --timeout 180     # slow command, full patience
"""

import argparse
import json
import re
import sys
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    sys.stderr.write(
        "pyserial is not installed.\n"
        "  Windows: python -m pip install pyserial\n"
        "  Linux/macOS: python3 -m pip install pyserial\n"
    )
    sys.exit(3)


# Prompts we recognise without being told. Zephyr's shell uses "uart:~$"; the nRF91 modem shell
# (MoSh) uses "mosh:~$". The generic forms cover custom shells built on the same subsystem.
KNOWN_PROMPTS = [
    r"mosh:~\$",
    r"uart:~\$",
    r"[a-zA-Z0-9_-]+:~\$",
    r"shell>",
]
DEFAULT_PROMPT = "|".join(KNOWN_PROMPTS)

# Not every board runs a shell. The nRF91 `at_client` sample -- and any bare AT firmware -- has NO prompt
# at all: it answers a command and stops. Its completion signal is the AT result code itself.
#
# Found on real hardware 2026-08-19, not in review: an nRF9161 DK answered `help` with `ERROR` and a bare
# newline with silence, so prompt-only detection waited the full timeout for every command and reported
# TIMEOUT on answers that had arrived in 40 ms. Both shapes have to be first-class.
AT_DONE = re.compile(r"(?:^|\n)(?:OK|ERROR|\+CM[ES] ERROR:[^\n]*)\s*$")

# A command's own echo comes back first on most shells. Stripping it keeps the transcript readable.
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def compile_prompt(pattern):
    """Anchor a prompt pattern to the END of the buffer. Containing a prompt is not finishing with one."""
    return re.compile("(?:" + pattern + r")\s*$")


def clean(text):
    """Strip ANSI colour/cursor codes and normalise line endings. Zephyr shells emit both freely."""
    return ANSI_RE.sub("", text).replace("\r\n", "\n").replace("\r", "\n")


def list_ports():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("No serial ports found.")
        print("Plug the board in. On Linux you may also need to be in the 'dialout' group.")
        return 1
    print(f"{'PORT':<16} {'DESCRIPTION'}")
    for p in ports:
        print(f"{p.device:<16} {p.description}")
    print()
    print("On a Nordic DK the LOWEST-numbered J-Link port is normally the application console.")
    return 0


def open_port(port, baud, timeout=0.1):
    """
    Open the port, or explain clearly why we could not.

    The common failure is not a broken port: it is that a log capture already holds it. A serial port is
    exclusive on Windows, and the raw error ("Access is denied") tells a developer nothing about which of
    their own tools is holding it.
    """
    try:
        ser = serial.Serial(port=port, baudrate=baud, timeout=timeout)
    except serial.SerialException as e:
        msg = str(e)
        busy = (
            "Access is denied" in msg  # Windows
            or "exclusively lock" in msg  # Linux (pyserial flock)
            or "Errno 11" in msg  # Linux EAGAIN on the lock
            or "Errno 16" in msg  # macOS EBUSY -- Resource busy
            or "Resource busy" in msg
            or "PermissionError" in msg
            or "Errno 13" in msg  # POSIX EACCES: also the dialout-group case on Linux
        )
        if busy:
            sys.stderr.write(
                f"Cannot open {port} - something else is already using it.\n\n"
                "A serial port can only be held by one program at a time. The usual cause is a log\n"
                "capture still running on this same port. Stop the capture, then run this again.\n"
                "Other candidates: a serial monitor, PuTTY/screen, or the nRF Connect Serial Terminal.\n"
            )
            if sys.platform.startswith("linux") and ("Errno 13" in msg or "PermissionError" in msg):
                sys.stderr.write(
                    "\nOn Linux this is more often permissions than contention. Check group membership:\n"
                    "    sudo usermod -a -G dialout $USER   (then log out and back in)\n"
                )
        elif "could not open port" in msg.lower() or "FileNotFoundError" in msg:
            sys.stderr.write(
                f"Port {port} does not exist.\n\n"
                "Run with --list-ports to see what is actually attached.\n"
            )
        else:
            sys.stderr.write(f"Cannot open {port}: {msg}\n")
        sys.exit(2)

    # DTR/RTS assert the line on boards that gate output on them; without this some DKs stay silent.
    try:
        ser.dtr = True
        ser.rts = True
    except (OSError, serial.SerialException):
        pass  # not every adapter supports flow-control lines; the port still works
    return ser


def read_until_prompt(ser, prompt_re, hard_timeout, idle_timeout):
    """
    Read until the shell prompt returns, the board goes quiet, or we run out of patience.

    Three exits, in priority order:
      1. PROMPT - the shell says it is ready for more. The correct, fast exit.
      2. IDLE   - output arrived and then stopped for `idle_timeout`. Covers shells that do not reprint
                  a prompt, and boards that answer without one.
      3. TIMEOUT- nothing conclusive within `hard_timeout`. Reported honestly, never as success.
    """
    buf = ""
    start = time.time()
    last_data = None

    while True:
        chunk = ser.read(4096)
        now = time.time()

        if chunk:
            buf += chunk.decode("utf-8", errors="replace")
            last_data = now
            # Check only the tail: a prompt string can legitimately appear inside output.
            tail = clean(buf)[-200:]
            # Must END with the prompt, not merely contain it. `help` output that quotes "mosh:~$" would
            # otherwise cut the read off mid-answer.
            if prompt_re is not None and prompt_re.search(tail):
                return buf, "prompt", now - start
            # An AT result code ends the reply just as definitively as a prompt does.
            if AT_DONE.search(tail.rstrip()):
                return buf, "at-ok", now - start

        if last_data is not None and (now - last_data) >= idle_timeout:
            return buf, "idle", now - start

        if (now - start) >= hard_timeout:
            return buf, "timeout", now - start

        if not chunk:
            time.sleep(0.01)  # nothing waiting; yield rather than spin the CPU


def strip_echo(output, command):
    """Drop the shell's echo of the command and the trailing prompt, leaving just the answer."""
    text = clean(output)
    lines = text.split("\n")
    # The echo is normally the first line that contains the command as sent.
    for i, line in enumerate(lines[:3]):
        if command.strip() and command.strip() in line:
            lines = lines[i + 1 :]
            break
    # The trailing prompt is not part of the answer.
    while lines and (re.search(DEFAULT_PROMPT, lines[-1]) or not lines[-1].strip()):
        lines.pop()
    return "\n".join(lines).strip()


def send(ser, data, port):
    """
    Write to the port, or explain what went wrong instead of raising.

    Found 2026-08-20 by pointing the tool at the wrong device: a plain USB serial adapter with nothing
    listening behind it accepted the open and then timed out on the first write, and pyserial's
    SerialTimeoutException came straight out as a Python traceback. A developer who mistyped a port
    number deserves a sentence, not a stack trace.
    """
    try:
        ser.write(data)
        ser.flush()
        return True
    except serial.SerialTimeoutException:
        sys.stderr.write(
            f"{port} accepted the connection but will not accept data.\n\n"
            "The port exists, so this is usually the WRONG DEVICE rather than a broken one: something is\n"
            "there, but nothing is listening. On a Nordic DK the console is normally the lowest-numbered\n"
            "J-Link port -- run --list-ports and look for 'JLink CDC UART Port' in the description.\n"
            "A plain 'USB Serial Device' with nothing running behind it behaves exactly like this.\n"
        )
        return False
    except (OSError, serial.SerialException) as e:
        sys.stderr.write(f"Lost {port} while writing: {e}\n")
        return False


def detect_prompt(ser):
    """
    Ask the board what its prompt looks like by sending a bare newline.

    Cheaper and more reliable than guessing, and it means a custom shell works without a --prompt flag.
    Falls back to the known-prompt union when the board says nothing useful.
    """
    ser.reset_input_buffer()
    if not send(ser, b"\r\n", getattr(ser, "port", "the port")):
        return None, None
    out, _, _ = read_until_prompt(ser, compile_prompt(DEFAULT_PROMPT), hard_timeout=2.0, idle_timeout=0.4)
    for line in reversed(clean(out).split("\n")):
        line = line.strip()
        if line and re.search(DEFAULT_PROMPT, line):
            return re.escape(line), line
    # No prompt. Say so honestly instead of returning a pattern that cannot match -- the caller then
    # relies on AT_DONE, which is the correct completion signal for a bare AT client.
    return None, None


def run(args):
    commands = list(args.cmd or [])
    if args.script:
        try:
            with open(args.script, "r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if line and not line.startswith("#"):
                        commands.append(line)
        except OSError as e:
            sys.stderr.write(f"Cannot read script {args.script}: {e}\n")
            return 2

    if not commands:
        sys.stderr.write("Nothing to send. Use --cmd or --script (or --list-ports to look around).\n")
        return 2

    ser = open_port(args.port, args.baud)
    results = []
    try:
        # Let the board settle and throw away any boot banner already in the buffer, so the first
        # command's transcript is its own answer and not the tail of a log.
        time.sleep(args.settle)
        ser.reset_input_buffer()

        if args.prompt:
            prompt_pattern, detected = args.prompt, None
        else:
            prompt_pattern, detected = detect_prompt(ser)
            if detected and not args.json:
                print(f"# shell prompt: {detected}", file=sys.stderr)
        prompt_re = compile_prompt(prompt_pattern) if prompt_pattern else None

        for command in commands:
            wire = f"at {command}" if args.at and not command.startswith("at ") else command
            ser.reset_input_buffer()
            if not send(ser, (wire + "\r\n").encode("utf-8"), args.port):
                return 2
            raw, why, elapsed = read_until_prompt(ser, prompt_re, args.timeout, args.idle)
            output = strip_echo(raw, wire)

            # An "idle" that produced nothing but the command echo has told us NOTHING, and must never be
            # handed back as an answer.
            #
            # Field report 2026-08-20: `AT+COPS=?` (a network scan that takes 2-5 MINUTES) returned after
            # 0.82 s with "[IDLE] (no output)". The agent tabulated that as "No NB-IoT network visible
            # here" and told the developer their location had no coverage. The scan had not even started.
            #
            # So: keep waiting for the real answer until the hard timeout, then say plainly that nothing
            # conclusive arrived.
            deadline = time.time() + max(0.0, args.timeout - elapsed)
            while why == "idle" and not output.strip() and time.time() < deadline:
                more, why, extra = read_until_prompt(ser, prompt_re, deadline - time.time(), args.idle)
                if not more:
                    break
                raw += more
                elapsed += extra
                output = strip_echo(raw, wire)
            if not output.strip() and why != "at-ok":
                why = "inconclusive"

            results.append(
                {"command": command, "sent": wire, "output": output, "exit": why, "seconds": round(elapsed, 3)}
            )
    finally:
        try:
            ser.close()
        except Exception:
            pass

    if args.json:
        print(json.dumps({"port": args.port, "results": results}, indent=2))
    else:
        for r in results:
            # "prompt" and "at-ok" are clean completions. "idle" is a guess and "timeout" is a failure,
            # so those two are the only ones worth putting in front of a reader.
            note = "" if r["exit"] in ("prompt", "at-ok") else f"  [{r['exit'].upper()}]"
            print(f"=== {r['command']} ===  ({r['seconds']}s){note}")
            if r["output"]:
                print(r["output"])
            elif r["exit"] in ("inconclusive", "timeout"):
                print("(NO ANSWER -- this is NOT a result. The command did not complete in "
                      f"{r['seconds']}s. Do NOT conclude anything from it; raise --timeout and retry. "
                      "A network scan such as AT+COPS=? needs --timeout 300.)")
            else:
                print("(no output)")
            print()

    # A timeout is a real failure: the caller must not read an empty answer as "the board said nothing".
    return 1 if any(r["exit"] in ("timeout", "inconclusive") for r in results) else 0


def main():
    p = argparse.ArgumentParser(
        description="Send commands to a board's interactive shell and read the answers.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("USAGE")[-1],
    )
    p.add_argument("--port", help="Serial port (COM18, /dev/ttyACM0, /dev/tty.usbmodem...)")
    p.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    p.add_argument("--cmd", action="append", help="A command to send. Repeat for several, in order.")
    p.add_argument("--script", help="File of commands, one per line. # comments and blanks ignored.")
    p.add_argument("--at", action="store_true", help="Prefix each command with 'at ' for the nRF91 modem shell")
    p.add_argument("--prompt", help="Prompt regex. Auto-detected when omitted.")
    p.add_argument("--timeout", type=float, default=10.0, help="Hard limit per command, seconds (default: 10). AT+COPS=? needs 300")
    p.add_argument("--idle", type=float, default=0.6, help="Treat output as finished after this quiet gap (default: 0.6)")
    p.add_argument("--settle", type=float, default=0.3, help="Pause after opening before sending (default: 0.3)")
    p.add_argument("--json", action="store_true", help="Machine-readable output")
    p.add_argument("--list-ports", action="store_true", help="List serial ports and exit")
    args = p.parse_args()

    if args.list_ports:
        return list_ports()
    if not args.port:
        p.error("--port is required (or use --list-ports)")
    return run(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)
