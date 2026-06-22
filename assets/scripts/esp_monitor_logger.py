#!/usr/bin/env python3
"""
ESP-IDF serial capture — the ESP analogue of nrf_uart_logger.py.

Primary engine is `idf.py monitor`: it decodes panic backtraces to file:line
using the project's build ELF (the whole point of capturing on ESP), so we keep
it as the real tool. `idf.py monitor` is project-bound — it needs a built IDF
project (`CMakeLists.txt` + `build/project_description.json`) — so each device is
captured **inside its own project**. Multiple devices (e.g. a BLE central +
peripheral) capture **concurrently**, each into its own log, via `--devices`.

Only when a device has no valid built project, or `idf.py monitor` cannot launch,
do we fall back to a clean **raw pyserial** capture keyed on the port alone (no
panic decode, but you still get the log). The fallback is for those critical
cases — the default path is always the real `idf.py monitor`.

Output file (mirrors the nRF naming convention):
    <output>/uart/<name>_<chip>_<port>_<YYYYMMDD_HHMMSS>.log

Usage:
    # single device (back-compatible)
    esp_monitor_logger.py --project /path/to/proj --port /dev/ttyUSB0 --duration 10

    # multiple devices, each in its own project, captured at the same time:
    esp_monitor_logger.py --duration 20 \\
        --devices central:COM3:C:/work/proto/central,peripheral:COM5:C:/work/proto/peripheral

    # two boards that share one project (same firmware), decode via that project:
    esp_monitor_logger.py --project ./app --devices a:COM3,b:COM5 --duration 15
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
import time
from datetime import datetime

DEFAULT_DURATION = 10
DEFAULT_BAUD = 115200

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


def resolve_chip(project_dir: str | None, explicit: str | None) -> str:
    if explicit:
        return explicit
    if not project_dir:
        return "esp32"
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
    The ESP-IDF virtualenv Python — the interpreter idf.py expects to run under,
    and the one that reliably has pyserial for the raw fallback.
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


def is_built_idf_project(project_dir: str | None) -> bool:
    """
    True only when `idf.py monitor` can actually work for this project: it needs the
    project root (`CMakeLists.txt`) AND a completed build (`build/project_description.json`
    — the source of the target chip and the ELF used to decode backtraces). When this
    is False we capture raw serial instead of letting idf.py fail.
    """
    if not project_dir:
        return False
    has_cmake = os.path.isfile(os.path.join(project_dir, "CMakeLists.txt"))
    has_build = os.path.isfile(os.path.join(project_dir, "build", "project_description.json"))
    return has_cmake and has_build


def _popen_kwargs() -> dict:
    kwargs = dict(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, text=True, bufsize=1)
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    return kwargs


def stream_to_file(proc: subprocess.Popen, log_file, stop: threading.Event, prefix: str = "") -> None:
    """Read the subprocess's combined output line by line; tee to file (clean) + stdout."""
    assert proc.stdout is not None
    for line in proc.stdout:
        log_file.write(ANSI_RE.sub("", line))  # clean text in the file
        log_file.flush()
        sys.stdout.write(prefix + line if prefix else line)  # echo (prefixed when concurrent)
        sys.stdout.flush()
        if stop.is_set():
            break


def terminate(proc: subprocess.Popen) -> None:
    """Stop a monitor/capture subprocess and its child process group cleanly, then forcefully."""
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


def _run_capture_subprocess(cmd: list[str], duration: int, log_path: str, prefix: str, env: dict | None) -> bool:
    """Launch `cmd`, tee its output to log_path for `duration`s, then stop it. False if it won't launch."""
    popen_kwargs = _popen_kwargs()
    master_fd = slave_fd = None
    # POSIX: idf.py monitor's miniterm.Console() runs termios.tcgetattr(stdin) at startup — and
    # esp-idf-monitor >=1.9 (shipped with IDF v6.0) does this UNCONDITIONALLY in __init__, BEFORE its
    # ESP_IDF_MONITOR_TEST headless hook. With stdin=DEVNULL that throws "Inappropriate ioctl for device"
    # and the capture dies before a single line is read. Hand it a pseudo-TTY as stdin so the check
    # passes; we never write to the master, and ESP_IDF_MONITOR_TEST=1 makes the console reader ignore
    # input anyway, so the monitor sees an idle terminal and just streams serial output to its (piped)
    # stdout. Verified against esp-idf-monitor 1.9.0. (Windows' Console doesn't use termios — leave it.)
    if os.name != "nt":
        try:
            import pty

            master_fd, slave_fd = pty.openpty()
            popen_kwargs["stdin"] = slave_fd
        except (OSError, ImportError):
            master_fd = slave_fd = None  # fall back to the DEVNULL stdin set in _popen_kwargs

    def _close(fd):
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass

    try:
        proc = subprocess.Popen(cmd, env=env, **popen_kwargs)
    except (FileNotFoundError, OSError) as e:
        print(f"{prefix}launch failed ({e})", file=sys.stderr)
        _close(slave_fd)
        _close(master_fd)
        return False
    # The child dup'd the slave end; the parent no longer needs it. Keep the master open until cleanup —
    # closing it early would send EOF/HUP to the monitor's stdin.
    _close(slave_fd)
    stop = threading.Event()
    try:
        with open(log_path, "w", encoding="utf-8") as log_file:
            reader = threading.Thread(target=stream_to_file, args=(proc, log_file, stop, prefix), daemon=True)
            reader.start()
            try:
                proc.wait(timeout=duration)
            except subprocess.TimeoutExpired:
                pass  # expected — duration elapsed
            except KeyboardInterrupt:
                pass
            stop.set()
            terminate(proc)
            reader.join(timeout=3)
    finally:
        _close(master_fd)
    return True


def capture_via_idf_monitor(project: str, port: str | None, no_reset: bool, duration: int, log_path: str, prefix: str) -> bool:
    """
    Primary path: `idf.py -C <project> -p <port> monitor`, headless.

    `idf.py monitor` (esp-idf-monitor) refuses to start unless stdin is a real TTY (its
    miniterm.Console() calls termios.tcgetattr at startup). We run it headless, so
    _run_capture_subprocess hands it a pseudo-TTY (pty) as stdin to satisfy that check.
    ESP_IDF_MONITOR_TEST=1 is the complementary hook: it makes the console reader IGNORE
    input (so the idle pty is never consumed) while serial output keeps streaming to
    stdout. (Older monitors also skipped the TTY check under this env var; >=1.9 no
    longer does — hence the pty.) Returns False if idf.py could not be launched.
    """
    cmd = build_monitor_cmd(project, port, no_reset)
    print(f"{prefix}{' '.join(cmd)}")
    # ESP_IDF_MONITOR_TEST=1 → headless (skip TTY check, ignore stdin). PYTHONIOENCODING /
    # PYTHONUTF8 → force the CHILD idf_monitor's piped stdout to UTF-8: on Windows a pipe
    # defaults to cp1252, so a single non-cp1252 serial byte makes esp_idf_monitor's
    # ansi_color_converter crash with UnicodeEncodeError and TRUNCATE the capture. Our own
    # force_utf8_streams() only fixes this process; the child needs its own override.
    env = {**os.environ, "ESP_IDF_MONITOR_TEST": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    return _run_capture_subprocess(cmd, duration, log_path, prefix, env)


# A tiny, clean pyserial reader run under the IDF venv Python (which always has
# pyserial). It opens the port, optionally pulses DTR/RTS to reset the board into
# its app (esptool's classic sequence), and prints raw bytes for `duration`s.
_RAW_CAPTURE_SRC = r"""
import sys, time, serial
port, duration, no_reset = sys.argv[1], float(sys.argv[2]), sys.argv[3] == "1"
ser = serial.Serial(port, int(sys.argv[4]), timeout=0.5)
try:
    if not no_reset:
        ser.setDTR(False); ser.setRTS(True); time.sleep(0.1)
        ser.setRTS(False); time.sleep(0.1); ser.setDTR(True)
    deadline = time.time() + duration
    while time.time() < deadline:
        line = ser.readline()
        if line:
            sys.stdout.buffer.write(line); sys.stdout.buffer.flush()
finally:
    try: ser.close()
    except Exception: pass
"""


def capture_raw_serial(port: str | None, duration: int, no_reset: bool, log_path: str, prefix: str, baud: int) -> bool:
    """
    Critical-case fallback: raw serial capture keyed on the port alone (no project,
    no panic decode). Runs the reader under the IDF venv Python so pyserial is present
    even when this script itself runs under a system Python without it.
    """
    if not port:
        print(f"{prefix}ERROR: no port for raw capture", file=sys.stderr)
        with open(log_path, "w", encoding="utf-8") as f:
            f.write("ERROR: no serial port resolved for raw capture\n")
        return False
    cmd = [idf_python_interpreter(), "-c", _RAW_CAPTURE_SRC, port, str(duration), "1" if no_reset else "0", str(baud)]
    print(f"{prefix}raw serial capture on {port} (no panic decode)")
    ok = _run_capture_subprocess(cmd, duration + 5, log_path, prefix, None)
    if not ok:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"ERROR: raw serial capture could not start on {port}\n")
    return ok


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


# ---------------------------------------------------------------------------
# Device model + per-device capture
# ---------------------------------------------------------------------------


def parse_devices(spec: str, default_project: str | None) -> list[dict]:
    """
    Parse `--devices name:port[:project],name2:port2[:project2]`.

    Split each entry on the first two ':' only (maxsplit=2) so a Windows project
    path keeps its drive colon (e.g. `peripheral:COM5:C:/work/periph`). A missing
    per-device project falls back to the shared `--project`.
    """
    devices: list[dict] = []
    for entry in spec.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":", 2)
        name = parts[0].strip() or None
        port = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        project = parts[2].strip() if len(parts) > 2 and parts[2].strip() else default_project
        devices.append({"name": name, "port": port, "project": project})
    return devices


def capture_one(device: dict, duration: int, output: str, no_reset: bool, chip_override: str | None, baud: int, concurrent: bool) -> str:
    """Capture one device into its own log. Uses idf.py monitor when the project is built; else raw serial."""
    name = device.get("name")
    port = device.get("port") or find_usb_serial_port()
    project = device.get("project")
    project_abs = os.path.abspath(project) if project else None

    chip = resolve_chip(project_abs, chip_override)
    label = name or chip
    prefix = f"[esp-monitor:{label}] " if concurrent else "[esp-monitor] "
    log_path = build_log_path(output, label, chip, port)

    if not device.get("port"):
        print(f"{prefix}auto-selected port: {port or 'none found'}")
    print(f"{prefix}capturing {duration}s → {log_path}")

    if is_built_idf_project(project_abs):
        ok = capture_via_idf_monitor(project_abs, port, no_reset, duration, log_path, prefix)
        if not ok:
            print(f"{prefix}idf.py monitor unavailable → falling back to raw serial capture")
            capture_raw_serial(port, duration, no_reset, log_path, prefix, baud)
    else:
        if project_abs:
            reason = "not a built ESP-IDF project (need CMakeLists.txt + build/project_description.json)"
        else:
            reason = "no project given"
        print(f"{prefix}{reason} → raw serial capture (panic backtraces will NOT be decoded)")
        capture_raw_serial(port, duration, no_reset, log_path, prefix, baud)

    print(f"{prefix}done — {summarize(log_path)}")
    print(f"{prefix}log: {log_path}")
    return log_path


def main() -> int:
    force_utf8_streams()
    parser = argparse.ArgumentParser(description="Capture ESP-IDF serial logs (wraps idf.py monitor; raw-serial fallback).")
    parser.add_argument("--project", default=".", help="ESP-IDF project directory (single-device default: .)")
    parser.add_argument("--port", help="Serial port (e.g. /dev/ttyUSB0, COM5). Auto-detected if omitted.")
    parser.add_argument(
        "--devices",
        help="Capture several boards at once, each in its own project: "
        "name:port[:project],name2:port2[:project2]. Per-device project falls back to --project.",
    )
    parser.add_argument("--duration", type=int, default=DEFAULT_DURATION, help=f"Seconds to capture (default: {DEFAULT_DURATION})")
    parser.add_argument("--name", help="Label for the log filename (single device; default: chip name)")
    parser.add_argument("--chip", help="Chip target for the filename (default: read from build/project_description.json)")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help=f"Baud rate for the raw fallback (default: {DEFAULT_BAUD})")
    parser.add_argument("--output", default="logs", help="Output directory (default: logs/)")
    parser.add_argument("--no-reset", action="store_true", help="Do not reset the board before capture (mid-runtime capture)")
    args = parser.parse_args()

    if args.devices:
        devices = parse_devices(args.devices, args.project if args.project != "." else None)
        if not devices:
            print("[esp-monitor] ERROR: --devices was empty", file=sys.stderr)
            return 1
    else:
        devices = [{"name": args.name, "port": args.port, "project": args.project}]

    concurrent = len(devices) > 1
    if concurrent:
        print(f"[esp-monitor] capturing {len(devices)} devices concurrently for {args.duration}s")
        threads = []
        for dev in devices:
            t = threading.Thread(
                target=capture_one,
                args=(dev, args.duration, args.output, args.no_reset, args.chip, args.baud, True),
                daemon=True,
            )
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
    else:
        capture_one(devices[0], args.duration, args.output, args.no_reset, args.chip, args.baud, False)

    return 0


if __name__ == "__main__":
    sys.exit(main())
