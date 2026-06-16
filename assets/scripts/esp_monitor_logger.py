#!/usr/bin/env python3
"""
ESP-IDF serial capture — the ESP analogue of nrf_uart_logger.py.

`idf.py monitor` takes over the terminal and runs until you press Ctrl+], which
an automated agent cannot do. This script wraps it: it launches `idf.py monitor`
for a fixed duration, tees the serial output to a correctly-named log file, then
stops it cleanly. Because it is `idf.py monitor`, panic backtraces are already
decoded to file:line in the captured output (the whole point of capturing on ESP).

Output file (mirrors the nRF naming convention):
    <output>/uart/<name>_<chip>_<port>_<YYYYMMDD_HHMMSS>.log

The chip is read from <project>/build/project_description.json when not given, so
the filename records what the firmware was actually built for.

Usage:
    esp_monitor_logger.py --project /path/to/proj --port /dev/ttyUSB0 --duration 10
    esp_monitor_logger.py --project . --duration 20 --name wifi --no-reset
"""

# Keep annotations lazy so `str | None` signatures work on ESP-IDF's bundled
# Python (can be 3.9, where PEP 604 unions aren't evaluatable at def time).
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
from datetime import datetime

DEFAULT_DURATION = 10

# Strip ANSI color/escape sequences from the saved log so the file the agent
# reads is clean text (idf.py monitor colorizes its output). Terminal echo keeps
# the colors.
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")

# Markers worth surfacing in the one-line summary so the agent gets an instant
# signal without re-reading the whole file.
CRASH_MARKERS = [
    ("Guru Meditation", "Core panic (Guru Meditation)"),
    ("Backtrace:", "panic backtrace present"),
    ("Task watchdog", "Task watchdog timeout (TWDT)"),
    ("abort() was called", "abort() called"),
    ("Stack canary", "stack overflow (canary)"),
    ("Brownout detector", "brownout reset"),
    ("rst:0x", "reset cause logged"),
    ("assert failed", "assertion failed"),
]


def resolve_chip(project_dir: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    pd = os.path.join(project_dir, "build", "project_description.json")
    try:
        with open(pd, "r", encoding="utf-8") as f:
            target = json.load(f).get("target")
            if isinstance(target, str) and target:
                return target
    except (OSError, ValueError):
        pass
    return "esp32"


def sanitize_port(port: str | None) -> str:
    if not port:
        return "auto"
    # Drop the /dev/ prefix and any path separators for a clean filename token.
    token = port.replace("/dev/", "").replace("/", "_").replace("\\", "_")
    return token or "auto"


def find_usb_serial_port() -> str | None:
    """
    Best-effort: return the first ESP-like USB serial port so we never let
    idf.py/esptool scan every /dev/ttyS* (slow, noisy — 30+ failed opens).
    Prefers pyserial's port enumeration (always available in the IDF env),
    falling back to globbing the usual device nodes.
    """
    # USB-CDC / USB-UART nodes, in preference order, per platform.
    if sys.platform == "darwin":
        patterns = ["/dev/cu.usbmodem*", "/dev/cu.usbserial*", "/dev/cu.wchusbserial*", "/dev/cu.SLAB*"]
    elif os.name == "nt":
        patterns = []  # handled via pyserial below; globbing COM* isn't a filesystem op
    else:
        patterns = ["/dev/ttyACM*", "/dev/ttyUSB*"]

    try:
        from serial.tools import list_ports  # provided by pyserial (ships with ESP-IDF)

        ports = list(list_ports.comports())
        # Prefer ports whose description names a known ESP USB bridge / native USB.
        hints = ("cp210", "ch340", "ch910", "usb jtag", "usb-serial", "espressif", "usb single serial")
        for p in ports:
            text = f"{p.description} {p.hwid}".lower()
            if any(h in text for h in hints):
                return p.device
        # Otherwise the first non-built-in serial port (skip Linux /dev/ttyS*).
        for p in ports:
            dev = p.device
            if os.name == "nt" or dev.startswith("/dev/ttyACM") or dev.startswith("/dev/ttyUSB") or "usb" in dev.lower():
                return dev
    except Exception:
        pass

    import glob

    for pat in patterns:
        matches = sorted(glob.glob(pat))
        if matches:
            return matches[0]
    return None


def build_log_path(output: str, name: str, chip: str, port: str | None) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    uart_dir = os.path.join(output, "uart")
    os.makedirs(uart_dir, exist_ok=True)
    fname = f"{name}_{chip}_{sanitize_port(port)}_{ts}.log"
    return os.path.abspath(os.path.join(uart_dir, fname))


def idf_python_interpreter() -> str:
    """
    The ESP-IDF virtualenv Python — the interpreter idf.py expects to run under.
    `export.sh`/`export.ps1`/`export.bat` set IDF_PYTHON_ENV_PATH to the venv dir,
    so we derive the interpreter from it. Fall back to a `python` on PATH (a sourced
    env puts the venv first) and finally to the interpreter running this script.
    """
    env_path = os.environ.get("IDF_PYTHON_ENV_PATH")
    if env_path:
        candidate = (
            os.path.join(env_path, "Scripts", "python.exe")
            if os.name == "nt"
            else os.path.join(env_path, "bin", "python")
        )
        if os.path.isfile(candidate):
            return candidate
    return shutil.which("python") or shutil.which("python3") or sys.executable


def resolve_idf_py_argv() -> list[str]:
    """
    The argv prefix that launches idf.py, robust across Windows/macOS/Linux.

    On POSIX idf.py is directly executable (shebang + exec bit), so once the env is
    sourced the bare name works. On Windows idf.py is a plain `.py` that
    `subprocess.Popen` cannot exec directly — Windows' CreateProcess rejects it with
    `WinError 193: %1 is not a valid Win32 application` because it is not a native
    binary and Popen (unlike a shell) does not honor PATHEXT / file associations. So
    on Windows we invoke it through the IDF virtualenv Python instead.

    idf.py is located via IDF_PATH (set by export), with a PATH lookup as fallback.
    """
    idf_path = os.environ.get("IDF_PATH")
    idf_py = os.path.join(idf_path, "tools", "idf.py") if idf_path else None
    if not (idf_py and os.path.isfile(idf_py)):
        idf_py = shutil.which("idf.py")  # honors PATHEXT where a launcher is registered

    if os.name != "nt":
        return [idf_py] if idf_py else ["idf.py"]

    # Windows: must go through a Python interpreter.
    if not idf_py:
        # Env not sourced / IDF_PATH unset — let Popen surface the error, caught below.
        return ["idf.py"]
    return [idf_python_interpreter(), idf_py]


def build_monitor_cmd(project_dir: str, port: str | None, no_reset: bool) -> list[str]:
    cmd = resolve_idf_py_argv() + ["-C", project_dir]
    if port:
        cmd += ["-p", port]
    cmd.append("monitor")
    if no_reset:
        cmd.append("--no-reset")
    return cmd


def stream_to_file(proc: subprocess.Popen, log_file, stop: threading.Event) -> None:
    """Read the monitor's combined output line by line; tee to file + stdout."""
    assert proc.stdout is not None
    for line in proc.stdout:
        log_file.write(ANSI_RE.sub("", line))  # clean text in the file
        log_file.flush()
        sys.stdout.write(line)  # keep colors on screen
        sys.stdout.flush()
        if stop.is_set():
            break


def terminate(proc: subprocess.Popen) -> None:
    """Stop idf.py monitor and its child process group cleanly, then forcefully."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGINT)
    except (ProcessLookupError, OSError):
        pass
    try:
        proc.wait(timeout=3)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name != "nt":
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=3)
    except (subprocess.TimeoutExpired, ProcessLookupError, OSError):
        try:
            if os.name != "nt":
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            else:
                proc.kill()
        except (ProcessLookupError, OSError):
            pass


def summarize(log_path: str) -> str:
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return "no output captured"
    lines = content.count("\n")
    hits = [label for marker, label in CRASH_MARKERS if marker in content]
    # De-duplicate while preserving order.
    seen = []
    for h in hits:
        if h not in seen:
            seen.append(h)
    if seen:
        return f"{lines} lines; detected: {', '.join(seen)}"
    return f"{lines} lines; no crash markers detected"


def force_utf8_streams() -> None:
    """
    Windows consoles default to a legacy code page (e.g. cp1252) on which our status
    arrows and the raw UTF-8 bytes streamed from `idf.py monitor` are unencodable —
    printing them raises UnicodeEncodeError and aborts the capture. Reconfigure stdout
    and stderr to UTF-8 (errors replaced) so output never crashes the logger. No-op on
    platforms/streams that are already UTF-8 or don't support reconfigure.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def main() -> int:
    force_utf8_streams()
    parser = argparse.ArgumentParser(description="Capture ESP-IDF serial logs (wraps idf.py monitor).")
    parser.add_argument("--project", default=".", help="ESP-IDF project directory (default: .)")
    parser.add_argument("--port", help="Serial port (e.g. /dev/ttyUSB0, COM5). Auto-detected if omitted.")
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION, help=f"Seconds to capture (default: {DEFAULT_DURATION})")
    parser.add_argument("--name", help="Label for the log filename (default: chip name)")
    parser.add_argument("--chip", help="Chip target for the filename (default: read from build/project_description.json)")
    parser.add_argument("--output", default="logs", help="Output directory (default: logs/)")
    parser.add_argument("--no-reset", action="store_true", help="Do not reset the board before capture (mid-runtime capture)")
    args = parser.parse_args()

    project_dir = os.path.abspath(args.project)
    chip = resolve_chip(project_dir, args.chip)
    name = args.name or chip
    # Resolve the port up front so idf.py monitor doesn't scan every /dev/ttyS*.
    port = args.port or find_usb_serial_port()
    if not args.port:
        print(f"[esp-monitor] auto-selected port: {port or 'none found (idf.py will auto-detect)'}")
    log_path = build_log_path(args.output, name, chip, port)
    cmd = build_monitor_cmd(project_dir, port, args.no_reset)

    print(f"[esp-monitor] capturing {args.duration}s → {log_path}")
    print(f"[esp-monitor] {' '.join(cmd)}")

    # `idf.py monitor` (esp-idf-monitor) refuses to start unless stdin is a real
    # TTY — but we run it as a captured subprocess (piped stdout, no interactive
    # console), which has no TTY on any OS. ESP_IDF_MONITOR_TEST=1 is the monitor's
    # own supported headless hook: it skips the TTY requirement AND makes the console
    # reader ignore stdin (no keyboard input expected) while serial output keeps
    # streaming to stdout — exactly a fixed-duration automated capture. We tee that
    # stdout to the log and stop the monitor when the duration elapses.
    child_env = {**os.environ, "ESP_IDF_MONITOR_TEST": "1"}
    popen_kwargs = dict(
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        env=child_env,
    )
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        popen_kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(cmd, **popen_kwargs)
    except FileNotFoundError:
        print("[esp-monitor] ERROR: idf.py not found — the ESP-IDF environment is not sourced.", file=sys.stderr)
        return 1
    except OSError as e:
        # e.g. WinError 193 (not a valid Win32 app) if idf.py is somehow launched
        # directly on Windows, or the interpreter path is wrong. Make it actionable.
        print(
            f"[esp-monitor] ERROR: failed to launch monitor ({e}).\n"
            f"[esp-monitor] command was: {' '.join(cmd)}\n"
            "[esp-monitor] Ensure the ESP-IDF environment is sourced (IDF_PATH / IDF_PYTHON_ENV_PATH set).",
            file=sys.stderr,
        )
        return 1

    stop = threading.Event()
    with open(log_path, "w", encoding="utf-8") as log_file:
        reader = threading.Thread(target=stream_to_file, args=(proc, log_file, stop), daemon=True)
        reader.start()
        try:
            proc.wait(timeout=args.duration)
        except subprocess.TimeoutExpired:
            pass  # expected — duration elapsed, stop the monitor
        except KeyboardInterrupt:
            pass
        stop.set()
        terminate(proc)
        reader.join(timeout=3)

    print(f"[esp-monitor] done — {summarize(log_path)}")
    print(f"[esp-monitor] log: {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
