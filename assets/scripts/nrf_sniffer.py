#!/usr/bin/env python3
"""nRF Sniffer capture wrapper — over-the-air BLE.

Runs ``nrfutil ble-sniffer sniff`` for a bounded duration against a separate Nordic dongle/DK that is
flashed with the sniffer firmware, then stops it cleanly so the PCAP is flushed, and prints the path.

Windows-first: the child runs in its own process group so it can be stopped with CTRL_BREAK on Windows
(SIGINT on POSIX) — a clean stop lets nrfutil finalize the PCAP. Hard kill is the last resort; the PCAP
is written incrementally, so even then the captured packets remain readable.
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
    cmd = [args.nrfutil, "ble-sniffer", "sniff", "--port", args.port, "--output-pcap-file", str(args.output)]
    if args.follow_name:
        cmd += ["--follow-by-name", args.follow_name]
    elif args.follow_addr:
        cmd += ["--follow", args.follow_addr]
    return cmd


def stop(proc):
    """Stop nrfutil cleanly (so it flushes the PCAP), escalating to terminate/kill if it won't exit."""
    if proc.poll() is not None:
        return
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
    proc.terminate()
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
    print(f"[sniffer] capturing ~{args.duration:.0f}s on {args.port} -> {args.output}", flush=True)
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

    deadline = time.time() + max(1.0, args.duration)
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
