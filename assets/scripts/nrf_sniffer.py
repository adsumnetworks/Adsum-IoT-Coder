#!/usr/bin/env python3
"""nRF Sniffer capture wrapper — over-the-air BLE.

Runs ``nrfutil ble-sniffer sniff`` for a bounded duration against a separate Nordic dongle/DK that is
flashed with the sniffer firmware.

THE WRAPPER IS AUTHORITATIVE FOR THE CAPTURE WINDOW. nrfutil's ``--timeout`` is an idle/safety bound
(default 500 ms), NOT a wall-clock cap: against a busy advertising channel the timer keeps resetting and
the capture never self-stops. CONFIRMED ON REAL HARDWARE (PCA10059, nrfutil-ble-sniffer 4.1.1): a 15 s
request ran ~25 s, stopping only when this wrapper's own deadline fired. So we time the window here and
stop nrfutil ourselves after ``duration`` seconds; ``--timeout`` is passed only as a backstop.

Windows-first: the child runs in its own process group (CTRL_BREAK to flush the PCAP cleanly), and the
forceful escalation is a process-TREE kill (taskkill /F /T) — nrfutil spawns ``nrfutil-ble-sniffer`` as a
child, and a plain terminate() kills only the launcher, orphaning that child (which keeps holding the
dongle's COM port → the next capture hangs until it's force-killed; that's the "sniffs forever, works on
the 2nd try" symptom).
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

IS_WINDOWS = os.name == "nt"


def build_command(args):
    timeout_ms = max(1000, int(args.duration * 1000))
    cmd = [
        args.nrfutil,
        "ble-sniffer",
        "sniff",
        "--port",
        args.port,
        "--output-pcap-file",
        str(args.output),
        "--timeout",
        str(timeout_ms),
    ]
    if args.follow_name:
        cmd += ["--follow-by-name", args.follow_name]
    elif args.follow_addr:
        cmd += ["--follow", args.follow_addr]
    return cmd


def stop(proc):
    """Stop nrfutil cleanly (so it flushes the PCAP), escalating to a process-TREE kill if it won't exit.

    The forceful step takes down the whole tree, not just ``proc``: on Windows nrfutil spawns
    ``nrfutil-ble-sniffer`` as a child, and terminating only the launcher orphans that child, which keeps
    the dongle's serial port open and makes the next capture hang. ``taskkill /F /T`` (Windows) and a
    process-group SIGKILL (POSIX) avoid the orphan.
    """
    if proc.poll() is not None:
        return
    # 1. Graceful: CTRL_BREAK (Windows) / SIGINT (POSIX) lets nrfutil flush the PCAP and exit.
    try:
        if IS_WINDOWS:
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGINT)
    except Exception:
        pass
    try:
        proc.wait(timeout=8)
        return
    except subprocess.TimeoutExpired:
        pass
    # 2. Forceful TREE kill — don't orphan the nrfutil-ble-sniffer child (it holds the COM port).
    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            proc.kill()
    try:
        proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
        proc.kill()


def main():
    ap = argparse.ArgumentParser(description="Capture over-the-air BLE packets to a PCAP via nrfutil ble-sniffer.")
    ap.add_argument("--port", required=True, help="Serial port of the SNIFFER dongle (e.g. COM7 or /dev/ttyACM0).")
    ap.add_argument("--output", required=True, type=Path, help="Output .pcap path.")
    ap.add_argument("--duration", type=float, default=20.0, help="Capture window in seconds (default 20).")
    ap.add_argument("--follow-name", default=None, help="Follow a device by advertised name.")
    ap.add_argument("--follow-addr", default=None, help="Follow a device by BD address.")
    ap.add_argument("--nrfutil", default="nrfutil", help="nrfutil executable (default: on PATH).")
    args = ap.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    cmd = build_command(args)

    print("[sniffer] " + " ".join(cmd), flush=True)
    print(
        f"[sniffer] capturing ~{args.duration:.0f}s on {args.port} -> {args.output} (nrfutil self-stops via --timeout)",
        flush=True,
    )
    print("[sniffer] reproduce the BLE issue now (advertise / connect / pair) so it lands in the capture.", flush=True)

    popen_kwargs = {}
    if IS_WINDOWS:
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(cmd, **popen_kwargs)
    except FileNotFoundError:
        print(
            "[sniffer] ERROR: nrfutil not found on PATH. Install it, then `nrfutil install ble-sniffer device`.",
            file=sys.stderr,
            flush=True,
        )
        return 2

    # The wrapper owns the capture window: nrfutil's --timeout does NOT reliably cap wall-clock (see the
    # module docstring), so we stop it ourselves after `duration` seconds. A small startup grace keeps the
    # effective window close to what was requested without a wrong-by-10s overrun.
    STARTUP_GRACE_S = 1.5
    deadline = time.time() + max(1.0, args.duration) + STARTUP_GRACE_S
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                break  # nrfutil exited on its own (e.g. bad port / firmware) — surface it below
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        stop(proc)

    rc = proc.poll()
    if args.output.exists() and args.output.stat().st_size > 0:
        print(f"[sniffer] wrote {args.output} ({args.output.stat().st_size} bytes)", flush=True)
        return 0

    print(
        f"[sniffer] WARNING: no PCAP data at {args.output} (nrfutil exit {rc}). Check the dongle is flashed with "
        "the sniffer firmware and that --port is the SNIFFER dongle, not the device under test.",
        file=sys.stderr,
        flush=True,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
