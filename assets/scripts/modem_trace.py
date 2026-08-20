#!/usr/bin/env python3
"""
modem_trace.py - capture an nRF91 modem trace, decode it, and say what it means.

WHY THIS LIVES HERE
-------------------
This started life as scripts/modem-trace.ts and was invisible to every real user: `.vscodeignore`
excludes `scripts/**`, so it never shipped in the VSIX, and it ran through `npm run` which needs the
repo and node_modules. A knowledge bit told the agent to run it anyway. Ported to Python and moved
beside the loggers, which DO ship, so the command in the bit is a command a user can actually run.

WHAT IT DOES THAT nrfutil DOES NOT
----------------------------------
A modem trace is framed binary. Scraping it directly returns things that look almost like AT commands
and are not -- `ATD`, `+PAs`, `%RZD`. The fix is to let Nordic's own dissector parse it first:

    nrfutil trace lte --input-file t.bin --output-pcapng at.pcapng --pcapng-dissector-filter at

That turns 4.2 MB of framed binary into ~1.7 KB of AT traffic only, and scraping THAT is clean.

nrfutil then leaves you with a pcapng. This tool goes one step further and explains the AT dialogue in
English -- +CEREG states, EMM cause values, +CFUN modes, %MDMEV events -- because the codes are the
difference between "firmware bug" and "network fact", and looking each one up by hand is the slow part.

USAGE
-----
    modem_trace.py --decode logs/modem_trace.bin --out logs/
    modem_trace.py --capture --port COM5 --seconds 60 --out logs/
    modem_trace.py --decode t.bin --mfw mfw_nrf91x1_2.0.4      # pin the trace database

The .pcapng is still written for Wireshark whenever you want the full NAS/RRC packet detail.
"""

import argparse
import os
import re
import subprocess
import sys
import time

# ---------------------------------------------------------------------------
# The modem's vocabulary, in plain language.
# Sources: Nordic nRF91x1 AT command reference (+CEREG / +CFUN / %MDMEV) and 3GPP TS 24.301 Annex A
# for the EMM cause values. These are the codes that decide "firmware bug" vs "network fact".
# ---------------------------------------------------------------------------

# `+CEREG: <n>,<stat>` - the single most useful line in any cellular log.
CEREG = {
    "0": ("not registered, not searching", "Modem idle. Usually CFUN is not 1."),
    "1": ("registered (home)", "Attached to the home network."),
    "2": ("searching", "Looking for a network. Normal for ~30 s; persisting means no usable network."),
    "3": ("registration DENIED", "A network answered and refused. See the EMM cause below."),
    "4": ("unknown / out of coverage", "No usable signal."),
    "5": ("registered (roaming)", "Attached via a roaming partner. Success."),
    "90": ("SIM (UICC) failure", "The modem cannot read a SIM at all. Missing, dead, or not seated."),
    "91": ("no cell for the selected mode", "Coverage exists but not in the mode %XSYSTEMMODE selected."),
}

# 3GPP TS 24.301 Annex A - the network's own reason for refusing.
EMM_CAUSE = {
    "3": "Illegal UE - the network rejected this identity outright",
    "6": "Illegal ME - the equipment is barred",
    "7": "EPS services not allowed - the subscription does not permit LTE data",
    "8": "EPS and non-EPS services not allowed",
    "11": "PLMN not allowed - this operator is not permitted for this SIM",
    "12": "Tracking area not allowed",
    "13": "Roaming not allowed in this tracking area - very common on a trial SIM abroad",
    "14": "EPS services not allowed in this PLMN",
    "15": "No suitable cells in tracking area - the SIM may not roam here",
    "22": "Congestion - the network is busy, retry later",
    "35": "Requested service option not subscribed",
}

# `+CFUN: <mode>` - is the radio even on.
CFUN = {
    "0": "powered off",
    "1": "full functionality (normal)",
    "4": "flight mode (radio off)",
    "21": "activate LTE, keep GNSS off",
}

# `%MDMEV:` - Nordic's proprietary modem events.
MDMEV = [
    (re.compile(r"SEARCH STATUS 1"), "started searching for a network"),
    (re.compile(r"SEARCH STATUS 2"), "finished searching and found nothing usable"),
    (re.compile(r"RESET LOOP"), "modem reset loop - it is restarting repeatedly"),
    (re.compile(r"NO IMEI"), "no IMEI - the modem is not provisioned"),
    (re.compile(r"CE-LEVEL"), "coverage-enhancement level changed (weak signal, more repetition)"),
    (re.compile(r"BATTERY LOW"), "supply voltage too low for the radio"),
]

PRINTABLE_RUN = re.compile(r"[ -~]{3,}")


def nrfutil():
    """Prefer the user-scope nrfutil; fall back to PATH. Windows needs the .exe suffix."""
    exe = "nrfutil.exe" if sys.platform == "win32" else "nrfutil"
    local = os.path.join(os.path.expanduser("~"), ".nrfutil", "bin", exe)
    return local if os.path.exists(local) else "nrfutil"


def run(args, timeout=300):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return subprocess.CompletedProcess(args, 1, "", str(e))


def ensure_trace_command():
    """`nrfutil trace` ships separately and is missing on a fresh machine - the exact wall the agent hit."""
    if run([nrfutil(), "trace", "lte", "--help"], timeout=60).returncode == 0:
        return True
    print("nrfutil trace is not installed - installing it now (one-off, user-scope)...")
    r = run([nrfutil(), "install", "trace"], timeout=300)
    if r.returncode != 0:
        print("  could not install: " + (r.stderr or r.stdout or "").strip()[:200])
        print("  Run `nrfutil install trace` yourself, then try again.")
        return False
    print("  installed.")
    return True


def tshark():
    """
    Find tshark, which turns a pcapng into readable text.

    Wireshark installs it but does NOT put it on PATH on Windows, so `which tshark` finds nothing on a
    machine that has it. Checking the real install locations is the difference between the agent seeing
    the radio layer and never knowing it existed.
    """
    if sys.platform == "win32":
        candidates = [
            r"C:\\Program Files\\Wireshark\\tshark.exe",
            r"C:\\Program Files (x86)\\Wireshark\\tshark.exe",
        ]
    else:
        candidates = ["/usr/bin/tshark", "/usr/local/bin/tshark", "/opt/homebrew/bin/tshark"]
    for c in candidates:
        if os.path.exists(c):
            return c
    # Last resort: PATH. Works on Linux/macOS where packaging does put it there.
    return "tshark" if run(["tshark", "-v"], timeout=20).returncode == 0 else None


def packet_timeline(pcap):
    """
    The decoded packet list, with direction and timestamps, as text.

    The AT scrape alone hides the radio layer. On a real bench trace (2026-08-19) the AT view showed 13
    lines and "started searching", while the full decode also held 21 MasterInformationBlocks -- proof the
    modem had found real cells and read their broadcasts. That single fact moves the diagnosis from
    "no coverage" to "cells found, attach never completed", which points at the SIM instead of the sky.
    """
    ts = tshark()
    if not ts:
        return None, []
    r = run([ts, "-r", pcap], timeout=120)
    if r.returncode != 0 or not r.stdout.strip():
        return None, []
    lines = [l.rstrip() for l in r.stdout.splitlines() if l.strip()]
    kinds = {}
    for l in lines:
        # Strip the leading "  N   0.000000  ->  " columns and any trailing parenthetical detail.
        body = re.sub(r"^\s*\d+\s+[\d.]+\s*", "", l)
        body = re.sub(r"^[^A-Za-z]*", "", body)
        body = re.sub(r"\([^)]*\)", "", body).strip()
        # Group by KIND, not by exact text. Otherwise every distinct AT command becomes its own bucket
        # with a count of 1 and buries the radio events, which are what carry the diagnosis.
        m = re.match(r"\w[\w-]*\s+\d+\s+(Sent|Rcvd) AT Command", body)
        if m:
            body = "AT command (%s)" % ("sent" if m.group(1) == "Sent" else "received")
        else:
            body = re.sub(r"\s+\d+\s+", " ", body).strip()  # drop tshark's length column
        if body:
            kinds[body] = kinds.get(body, 0) + 1
    return lines, sorted(kinds.items(), key=lambda kv: -kv[1])


def explain_radio(kinds):
    """What the radio layer proves, in the developer's language."""
    notes = []
    total = dict(kinds)
    mib = sum(n for k, n in total.items() if "MasterInformationBlock" in k)
    sib = sum(n for k, n in total.items() if "SystemInformation" in k)
    attach = sum(n for k, n in total.items() if "Attach" in k or "Tracking area" in k)
    reject = sum(n for k, n in total.items() if "Reject" in k or "reject" in k)

    if mib or sib:
        notes.append(
            f"The modem RECEIVED {mib + sib} cell broadcast(s) (MasterInformationBlock/SystemInformation). "
            "That is hard proof it found real LTE cells and was reading them."
        )
        if not attach and not reject:
            notes.append(
                "  But there is NO attach attempt in this capture. Cells were visible and the modem never "
                "tried to join, or the capture ended first. That points at the SIM, the subscription or the "
                "selected mode -- NOT at coverage. Do not tell the developer they have no signal."
            )
    elif total:
        notes.append(
            "No cell broadcasts in this capture: the modem saw no LTE cell at all. This one IS a coverage, "
            "antenna or band question."
        )
    if reject:
        notes.append(f"  {reject} reject message(s) present - read the EMM cause, the network gave a reason.")
    return notes


def extract_at(data):
    """
    Pull the AT dialogue out of a trace file.

    Deliberately a byte scrape rather than a pcapng parse, and run against the AT-FILTERED pcapng, never
    the raw trace. That distinction is the whole difference between working and not: scraping the raw
    trace walks across the framing and returns fragments that look like AT commands but are noise.
    """
    text = data.decode("latin-1")
    out = []
    for run_ in PRINTABLE_RUN.findall(text):
        s = run_.strip()
        if not s or len(s) > 160:
            continue
        if not (s.startswith("AT") or s.startswith("+") or s.startswith("%") or s in ("OK", "ERROR")):
            continue
        if out and out[-1] == s:
            continue  # collapse identical polling repeats
        out.append(s)
    return out


def explain(at):
    """Turn the AT dialogue into the answer the developer actually wants."""
    notes = []

    # Registration is the headline.
    cereg = [l for l in at if l.startswith("+CEREG:")]
    if cereg:
        stats = []
        for l in cereg:
            fields = [x.strip() for x in re.sub(r"^\+CEREG:\s*", "", l).split(",")]
            # <stat> is field 2 for an unsolicited "+CEREG: <n>,<stat>", field 1 for a bare notification.
            v = fields[1] if len(fields) > 1 else (fields[0] if fields else "")
            if v:
                stats.append(v)
        if stats:
            final = stats[-1]
            info = CEREG.get(final)
            notes.append(f"Registration ended at +CEREG stat {final} - {info[0] if info else 'unrecognised'}")
            if info:
                notes.append(f"  {info[1]}")
            if len(stats) > 1:
                seen = list(dict.fromkeys(stats))
                notes.append("  path through the attach: " + " -> ".join(seen))
    else:
        # AT+CEREG=5 is the SUBSCRIBE; +CEREG: is the answer. Saying "never subscribed" when the
        # subscribe is right there in the timeline is the kind of wrong that destroys trust in a tool.
        subscribed = any(l.startswith("AT+CEREG=") for l in at)
        if subscribed:
            notes.append(
                "Subscribed to registration status (AT+CEREG=), but NO +CEREG answer arrived in this "
                "capture - the modem never reported a registration state. Usually the capture ended "
                "during the search."
            )
        elif any(l.startswith(("AT%XSYSTEMMODE", "AT+CFUN", "AT%MDMEV")) for l in at):
            # The app is clearly driving the modem, so it is using lte_lc / nrf_modem_lib, which subscribes
            # through the library rather than a literal AT+CEREG=5. Claiming it "never subscribed" is a
            # tool defect, and a confident wrong note is worse than no note at all.
            notes.append(
                "No +CEREG lines in this capture. The app configures the modem through the modem library "
                "(lte_lc), which does not emit a literal AT+CEREG=5, so this is expected - registration "
                "state lives in the application log, not here."
            )
        else:
            notes.append(
                "No +CEREG traffic at all, and nothing else driving the modem either - this capture may "
                "have missed the attach entirely."
            )

    # Why a refusal happened.
    for l in at:
        m = re.search(r"(?:\+CEER|\+EMM|cause)[^0-9]{0,6}(\d{1,3})", l, re.I)
        if m and m.group(1) in EMM_CAUSE:
            notes.append(f"Network reject cause {m.group(1)}: {EMM_CAUSE[m.group(1)]}")

    # SIM.
    if any(re.search(r"UICC|\+CEREG:\s*(?:\d,)?90", l) for l in at):
        notes.append("SIM: the modem reported a UICC failure - it could not read a card at all.")
    elif any(l.startswith("%XICCID") for l in at):
        notes.append("SIM: an ICCID was read, so the card is present and readable.")

    # Radio mode and what was asked of it.
    sysmode = next((l for l in at if l.startswith("AT%XSYSTEMMODE=")), None)
    if sysmode:
        f = sysmode.split("=", 1)[1].split(",") if "=" in sysmode else []
        on = []
        for idx, name in ((0, "LTE-M"), (1, "NB-IoT"), (2, "GNSS")):
            if len(f) > idx and f[idx].strip() == "1":
                on.append(name)
        notes.append(f"Radio modes enabled: {' + '.join(on) if on else 'none'} (%XSYSTEMMODE {','.join(f)})")
        if len(on) == 1 and on[0] != "GNSS":
            notes.append("  Only one access technology is enabled. If the SIM needs the other, it can never attach.")

    cfun = [l for l in at if l.startswith("AT+CFUN=")]
    if cfun:
        mode = cfun[-1].split("=", 1)[1].strip()
        notes.append(f"Modem functional mode set to {mode} - {CFUN.get(mode, 'see the AT reference')}")

    # Nordic modem events.
    for l in at:
        if not l.startswith("%MDMEV"):
            continue
        for pattern, meaning in MDMEV:
            if pattern.search(l):
                notes.append(f"Modem event: {meaning}  ({l})")

    if any(l == "ERROR" for l in at):
        notes.append("At least one AT command returned ERROR - check the command just before it in the timeline.")
    return notes


def decode(bin_path, out_dir, mfw=None):
    if not os.path.exists(bin_path):
        print(f"No trace at {bin_path}")
        return 1
    with open(bin_path, "rb") as f:
        data = f.read()
    print(f"Trace: {bin_path}  ({len(data) / 1024 / 1024:.1f} MB)")
    print()

    # pcapng for Wireshark - best effort, never fatal. The readable output below is the deliverable.
    pcap = os.path.join(out_dir, os.path.basename(bin_path).replace(".bin", "") + ".pcapng")
    if ensure_trace_command():
        args = [nrfutil(), "trace", "lte", "--input-file", bin_path, "--output-pcapng", pcap]
        if mfw:
            # Autodetect can pick the wrong trace database; AT+CGMR tells you which firmware is running.
            args += ["--mfw-revision-id", mfw]
        ok = run(args).returncode == 0
        print(f"Wireshark file: {pcap}" if ok else "pcapng decode failed (readable output below is unaffected)")

    # Second pass: an AT-ONLY pcapng. Small, and the only reliable source of readable AT text.
    # Name every artefact after the trace it came from. Fixed names meant a second decode destroyed the
    # first, and the agent went on quoting a file that no longer held what it thought (2026-08-20).
    stem = os.path.splitext(os.path.basename(bin_path))[0]
    at_pcap = os.path.join(out_dir, stem + "-at.pcapng")
    r = run(
        [nrfutil(), "trace", "lte", "--input-file", bin_path, "--output-pcapng", at_pcap,
         "--pcapng-dissector-filter", "at"]
    )
    if r.returncode == 0 and os.path.exists(at_pcap):
        with open(at_pcap, "rb") as f:
            at = extract_at(f.read())
    else:
        print("could not produce the AT-filtered view; falling back to the raw trace (results may be noisy)")
        at = extract_at(data)

    at_file = os.path.join(out_dir, stem + "-at-timeline.txt")
    with open(at_file, "w", encoding="utf-8") as f:
        f.write("\n".join(at) + "\n")

    print()
    print("=" * 72)
    print("WHAT THE MODEM DID")
    print("=" * 72)
    print(f"{len(at)} AT lines recovered -> {at_file}")
    print()
    for l in at[:40]:
        print(f"  {l}")
    if len(at) > 40:
        print(f"  ... {len(at) - 40} more in the file above")

    # The radio layer, when tshark can read it for us. This is the half the AT scrape cannot see.
    lines, kinds = packet_timeline(pcap) if os.path.exists(pcap) else (None, [])
    if lines:
        tl_file = os.path.join(out_dir, stem + "-packets.txt")
        with open(tl_file, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print()
        print("=" * 72)
        print("WHAT THE RADIO DID")
        print("=" * 72)
        print(f"{len(lines)} decoded packets -> {tl_file}")
        print()
        for kind, count in kinds[:12]:
            print(f"  {count:>4}  {kind}")
        if len(kinds) > 12:
            print(f"  ... {len(kinds) - 12} more kinds in the file above")

    print()
    print("=" * 72)
    print("WHAT IT MEANS")
    print("=" * 72)
    for n in explain(at) + explain_radio(kinds):
        print(f"  {n}")
    print()
    if lines:
        print("  Open the .pcapng in Wireshark for per-packet detail.")
    else:
        # Never fail silently into a thinner answer -- say what is missing and how to get it.
        print("  NOTE: Wireshark/tshark was not found, so the radio layer above could not be decoded.")
        print("  The AT view alone cannot tell 'no coverage' from 'cells found but never joined'.")
        print("  Install Wireshark (winget install WiresharkFoundation.Wireshark) and decode again.")
    return 0


def capture(port, seconds, out_dir, mfw=None):
    if not ensure_trace_command():
        return 1
    raw = os.path.join(out_dir, f"modem_trace_{int(time.time())}.bin")
    print(f"Capturing {seconds}s from {port} -> {raw}")
    print("(reset the board now if you want the boot and attach in the capture)")
    run([nrfutil(), "trace", "lte", "--input-serialport", port, "--output-raw", raw], timeout=seconds + 15)
    if not os.path.exists(raw):
        print("Capture produced nothing.")
        print("Is the trace UART the right port? It is a DIFFERENT port from the application console.")
        return 1
    return decode(raw, out_dir, mfw)


def main():
    p = argparse.ArgumentParser(
        description="nRF91 modem trace - capture, decode, explain.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("USAGE")[-1],
    )
    p.add_argument("--decode", metavar="TRACE.BIN", help="Decode and explain an existing raw trace")
    p.add_argument("--capture", action="store_true", help="Capture a new trace, then decode it")
    p.add_argument("--port", help="Trace UART port for --capture (NOT the application console)")
    p.add_argument("--seconds", type=int, default=60, help="Capture length (default: 60)")
    p.add_argument("--out", default=".", help="Output directory (default: current)")
    p.add_argument("--mfw", help="Pin the trace database, e.g. mfw_nrf91x1_2.0.4 (from AT+CGMR)")
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)
    if args.decode:
        return decode(args.decode, args.out, args.mfw)
    if args.capture:
        if not args.port:
            print("--capture needs --port COMx")
            return 1
        return capture(args.port, args.seconds, args.out, args.mfw)
    p.print_help()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)
