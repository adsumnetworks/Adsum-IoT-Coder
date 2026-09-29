#!/usr/bin/env python3
"""blg20_service.py - a BLG20 gateway's USB-C service port, from a PC (Adsum IoT Coder's tool).

    blg20-service list                          the BLG20 units on USB and their two ports
    blg20-service passport [--chip lte]         what the unit is (locked: identity, versions)
    blg20-service needs                         what it needs, as a closed list of codes
    blg20-service claim                         make this PC's owner key the unit's owner key
    blg20-service health                        status2 and the store (owner only)
    blg20-service logs [--chip ble|lte] [--lines N]
    blg20-service images [--chip ble|lte]       the image slots
    blg20-service update-ble FILE               BLE half: upload, test, reboot, wait, confirm
    blg20-service update-lte FILE               LTE half, through the tunnel, the same way
    blg20-service lock | owner | owner-clear | keygen | key-path | doctor
    add --json to any command for one JSON object on stdout (progress goes to stderr)

KEYS. The owner key lives in this PC's keyring folder (see `key-path`), is created by `claim` or
`keygen`, never leaves this PC and is never printed. `--key PEM` uses another key (the vendor
service key, a colleague's). The unit holds public keys only.

SESSIONS. The unit ends an unlocked session when the service port closes, so one run of this tool
is one session: it unlocks once and does everything inside it. The LTE half is reached through the
second port, which the unit opens only while the first is unlocked; the tool keeps the first open.

Needs pyserial and cryptography (`doctor` says which is missing). CBOR is built in: SMP uses a
small subset, and one dependency fewer is one install fewer on a customer's PC. Windows, macOS and
Linux.
"""
import argparse
import base64
import hashlib
import json
import os
import struct
import sys
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:                    # `doctor` reports it; every other command needs it
    serial = None

VID, PID = 0x1209, 0x0001
PRODUCT = "BLG20 Gateway"
GROUP_OS, GROUP_IMG, GROUP_SVC = 0, 1, 64
SVC = {"passport": 0, "health": 1, "needs": 2, "challenge": 3, "unlock": 4, "lock": 5, "owner": 6,
       "logtail": 7}
OS_ECHO, OS_RESET, OS_PARAMS = 0, 5, 6
IMG_STATE, IMG_UPLOAD = 0, 1
OP_READ, OP_WRITE = 0, 2
SMP_V2 = 1 << 3                      # SMP version 1 ("v2" framing of errors) in bits 3-4
MAX_LINE = 127                       # zephyr serial_util MCUMGR_SERIAL_MAX_FRAME
RC_NAMES = {0: "ok", 1: "unknown", 2: "no-memory", 3: "invalid", 4: "timeout", 5: "no-entry",
            6: "bad-state", 7: "too-big", 8: "not-supported", 9: "corrupt", 10: "busy",
            11: "ACCESS DENIED (unit is locked)"}   # MGMT_ERR_EACCESSDENIED = 11 (measured)
OWNER_TAG = b"BLG20-OWNER-1"
OWNER_KEY_FILE = "blg20-owner.pem"


class ToolError(Exception):
    pass


# ── CBOR: the subset SMP uses (RFC 8949) ──────────────────────────────────────────────────────

_BREAK = object()


def cbor_dumps(obj):
    out = bytearray()

    def head(major, n):
        if n < 24:
            out.append(major << 5 | n)
        elif n < 0x100:
            out.extend((major << 5 | 24, n))
        elif n < 0x10000:
            out.append(major << 5 | 25)
            out.extend(n.to_bytes(2, "big"))
        elif n < 0x100000000:
            out.append(major << 5 | 26)
            out.extend(n.to_bytes(4, "big"))
        else:
            out.append(major << 5 | 27)
            out.extend(n.to_bytes(8, "big"))

    def enc(v):
        if v is True:
            out.append(0xF5)
        elif v is False:
            out.append(0xF4)
        elif v is None:
            out.append(0xF6)
        elif isinstance(v, int):
            head(0, v) if v >= 0 else head(1, -1 - v)
        elif isinstance(v, (bytes, bytearray)):
            head(2, len(v))
            out.extend(v)
        elif isinstance(v, str):
            b = v.encode("utf-8")
            head(3, len(b))
            out.extend(b)
        elif isinstance(v, (list, tuple)):
            head(4, len(v))
            for x in v:
                enc(x)
        elif isinstance(v, dict):
            head(5, len(v))
            for k, x in v.items():
                enc(k)
                enc(x)
        else:
            raise TypeError(f"cannot encode {type(v).__name__} as CBOR")

    enc(obj)
    return bytes(out)


def cbor_loads(data):
    pos = 0

    def take(n):
        nonlocal pos
        if pos + n > len(data):
            raise ValueError("truncated CBOR")
        b = data[pos:pos + n]
        pos += n
        return b

    def arg(ai):
        if ai < 24:
            return ai
        if ai in (24, 25, 26, 27):
            return int.from_bytes(take(1 << (ai - 24)), "big")
        if ai == 31:
            return None                                  # indefinite length
        raise ValueError(f"bad CBOR length code {ai}")

    def dec():
        ib = take(1)[0]
        major, ai = ib >> 5, ib & 31
        if major == 7:
            if ai == 31:
                return _BREAK
            if ai in (20, 21, 22, 23):
                return (False, True, None, None)[ai - 20]
            if ai == 25:
                return struct.unpack(">e", take(2))[0]
            if ai == 26:
                return struct.unpack(">f", take(4))[0]
            if ai == 27:
                return struct.unpack(">d", take(8))[0]
            return arg(ai)
        n = arg(ai)
        if major == 0:
            return n
        if major == 1:
            return -1 - n
        if major in (2, 3):
            if n is None:
                parts = []
                while True:
                    p = dec()
                    if p is _BREAK:
                        break
                    parts.append(p)
                return (b"" if major == 2 else "").join(parts)
            raw = take(n)
            return bytes(raw) if major == 2 else raw.decode("utf-8", "replace")
        if major == 4:
            items = []
            while n is None or len(items) < n:
                v = dec()
                if v is _BREAK:
                    break
                items.append(v)
            return items
        if major == 5:
            m, i = {}, 0
            while n is None or i < n:
                k = dec()
                if k is _BREAK:
                    break
                m[k if not isinstance(k, (list, dict)) else repr(k)] = dec()
                i += 1
            return m
        return dec()                                     # major 6: a tag, keep the value

    return dec()


# ── transport ─────────────────────────────────────────────────────────────────────────────────

def need_serial():
    if serial is None:
        raise ToolError("pyserial is not installed for this Python (run `doctor`)")


def crc16_xmodem(data, crc=0):
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return crc


def find_ports():
    """{serial_number: [service_port, lte_tunnel_port]} for every BLG20 on USB."""
    need_serial()
    units = {}
    for p in serial.tools.list_ports.comports():
        if p.vid != VID or p.pid != PID:
            continue
        if p.product and PRODUCT not in p.product and "BLG20" not in (p.description or ""):
            continue
        # Linux: location ends ":1.0"/":1.2"; Windows: hwid carries "MI_00"/"MI_02". The first
        # CDC ACM function is the BLE service port, the second the LTE tunnel.
        iface = 0
        loc = p.location or ""
        if ":" in loc and "." in loc.rsplit(":", 1)[-1]:
            iface = int(loc.rsplit(".", 1)[-1])
        elif "MI_" in (p.hwid or ""):
            iface = int(p.hwid.split("MI_")[1][:2], 16)
        units.setdefault(p.serial_number or "?", []).append((iface, p.device))
    return {sn: [d for _, d in sorted(v)] for sn, v in units.items()}


class Smp:
    def __init__(self, port, timeout=5.0):
        need_serial()
        self.ser = serial.Serial(port, 115200, timeout=0.2)
        self.ser.dtr = True           # the session lives while DTR is up
        self.seq = 0
        self.timeout = timeout

    def close(self):
        try:
            self.ser.close()
        except OSError:                  # pyserial's SerialException is an OSError
            pass

    def _send(self, pkt):
        body = struct.pack(">H", len(pkt) + 2) + pkt + struct.pack(">H", crc16_xmodem(pkt))
        b64 = base64.b64encode(body)
        room = (MAX_LINE - 3) // 4 * 4            # 2 start bytes + newline, whole base64 quanta
        first = True
        for i in range(0, len(b64), room):
            self.ser.write((b"\x06\x09" if first else b"\x04\x14") + b64[i:i + room] + b"\n")
            first = False

    def _recv(self, timeout):
        buf, deadline, line = b"", time.time() + timeout, b""
        while time.time() < deadline:
            c = self.ser.read(1)
            if not c:
                continue
            if c != b"\n":
                line += c
                continue
            try:
                if line.startswith(b"\x06\x09"):
                    buf = base64.b64decode(line[2:])
                elif line.startswith(b"\x04\x14") and buf:
                    buf += base64.b64decode(line[2:])
            except ValueError:
                buf = b""
            line = b""
            if len(buf) >= 2:
                want = struct.unpack(">H", buf[:2])[0]
                if len(buf) - 2 >= want:
                    pkt, crc = buf[2:2 + want - 2], struct.unpack(">H", buf[want:want + 2])[0]
                    if crc16_xmodem(pkt) == crc:
                        return pkt
                    buf = b""
        raise TimeoutError("no answer (wrong port, the unit is rebooting, or it does not run "
                           "the service port)")

    def call(self, group, cid, op, body=None, timeout=None, retries=0):
        data = cbor_dumps(body if body is not None else {})
        for attempt in range(retries + 1):
            self.seq = (self.seq + 1) & 0xFF
            hdr = struct.pack(">BBHHBB", op | SMP_V2, 0, len(data), group, self.seq, cid)
            self.ser.reset_input_buffer()
            self._send(hdr + data)
            try:
                deadline = time.time() + (timeout or self.timeout)
                while True:
                    pkt = self._recv(max(0.1, deadline - time.time()))
                    _, _, ln, _, seq, _ = struct.unpack(">BBHHBB", pkt[:8])
                    if seq == self.seq:
                        break
            except TimeoutError:
                if attempt == retries:
                    raise
                continue
            rsp = cbor_loads(pkt[8:8 + ln]) if ln else {}
            rc = rsp.get("rc") if isinstance(rsp, dict) else None
            if rc is None and isinstance(rsp, dict) and isinstance(rsp.get("err"), dict):
                rc = rsp["err"].get("rc")
            if rc:
                raise PermissionError(f"group {group} id {cid}: rc {rc} "
                                      f"({RC_NAMES.get(rc, 'error')})")
            return rsp


# ── keys ──────────────────────────────────────────────────────────────────────────────────────

def keyring_dir():
    if os.name == "nt":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Adsum", "keys")
    return os.path.join(os.path.expanduser("~"), ".config", "adsum", "keys")


def default_key_path():
    return os.path.join(keyring_dir(), OWNER_KEY_FILE)


def keygen(path):
    """A new P-256 private key at `path`, readable by this user only. Never overwrites."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    if os.path.exists(path):
        raise ToolError(f"{path} already exists - not overwritten")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        os.chmod(os.path.dirname(path), 0o700)
    except OSError:
        pass
    pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return path


def sign_raw(key_path, msg):
    """ECDSA P-256 / SHA-256 over msg, as raw r || s (64 bytes)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    with open(key_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    r, s = decode_dss_signature(key.sign(msg, ec.ECDSA(hashes.SHA256())))
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def sign_unlock(key_path, ch):
    return sign_raw(key_path, ch["tag"].encode() + bytes(ch["nonce"]) + bytes(ch["dev"]))


def pub_bytes(path):
    from cryptography.hazmat.primitives import serialization
    with open(path, "rb") as f:
        data = f.read()
    try:
        key = serialization.load_pem_private_key(data, password=None).public_key()
    except (ValueError, TypeError):
        key = serialization.load_pem_public_key(data)
    return key.public_bytes(serialization.Encoding.X962,
                            serialization.PublicFormat.UncompressedPoint)


def owner_set(smp, owner_key_path):
    """Set the owner key (the claim, on an unclaimed unit). The NEW key proves possession by
    signing OWNER_TAG || nonce || dev || pub on a fresh challenge (service.c)."""
    pub = pub_bytes(owner_key_path)
    ch = smp.call(GROUP_SVC, SVC["challenge"], OP_READ)
    sig = sign_raw(owner_key_path, OWNER_TAG + bytes(ch["nonce"]) + bytes(ch["dev"]) + pub)
    return smp.call(GROUP_SVC, SVC["owner"], OP_WRITE, {"pub": pub, "sig": sig})


def unlock(smp, key_path):
    ch = smp.call(GROUP_SVC, SVC["challenge"], OP_READ)
    rsp = smp.call(GROUP_SVC, SVC["unlock"], OP_WRITE, {"sig": sign_unlock(key_path, ch)})
    if not rsp.get("ok"):
        raise PermissionError(f"unlock refused: {rsp.get('why')} (retry in {rsp.get('retry_s')} s;"
                              f" the unit expects the {ch.get('key')} key)")
    return rsp


# ── a session with one unit ───────────────────────────────────────────────────────────────────

def progress(msg):
    print(msg, file=sys.stderr, flush=True)


class Unit:
    def __init__(self, port=None, key=None):
        units = find_ports()
        if port:
            self.sn = next((sn for sn, p in units.items() if port in p), None)
            self.ports = units.get(self.sn, [port])
        else:
            if len(units) != 1:
                raise ToolError(f"found {len(units)} BLG20 units on USB - pass --port")
            self.sn, self.ports = next(iter(units.items()))
        self.key = key
        self.ble = Smp(self.ports[0])
        self._lte = None
        self.unlocked = False

    def close(self):
        if self._lte:
            self._lte.close()
        self.ble.close()

    def passport(self):
        return self.ble.call(GROUP_SVC, SVC["passport"], OP_READ)

    def ensure_unlocked(self):
        if self.unlocked:
            return
        key = self.key or default_key_path()
        if not os.path.exists(key):
            raise ToolError(f"no key at {key}. On a unit you own, run `claim` first; with "
                            f"another key, pass --key")
        p = self.passport()
        if not self.key and not p.get("claimed"):
            raise ToolError("this unit has no owner yet: run `claim` to make this PC's key its "
                            "owner (or pass --key with the vendor service key)")
        unlock(self.ble, key)
        self.unlocked = True

    def lte(self):
        if self._lte is None:
            if len(self.ports) < 2:
                raise ToolError("the unit shows no second (LTE) port")
            self.ensure_unlocked()
            self._lte = Smp(self.ports[1], timeout=8.0)
        return self._lte

    def smp(self, chip):
        return self.lte() if chip == "lte" else self.ble


def wait_port(sn, present, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if (sn in find_ports()) == present:
            return True
        time.sleep(0.5)
    return False


# ── image update ──────────────────────────────────────────────────────────────────────────────

MCUBOOT_MAGIC = b"\x3d\xb8\xf3\x96"
# What an image must carry so the unit can still be reached over USB after it boots. A BLE image
# built without service.conf + service.overlay has no USB port at all, and an LTE image without
# smp.conf has no server behind the tunnel: either one, confirmed, leaves SWD as the only way back.
MUST_CARRY = {"ble": (b"BLG20 Gateway", "the USB service port (build with service.conf and "
                                        "service.overlay)"),
              "lte": (b"SMP server on the link ready", "the link SMP server (build with "
                                                       "smp.conf)")}


def check_image(data, chip, force):
    if data[:4] != MCUBOOT_MAGIC:
        raise ToolError("not a signed MCUboot image: pass the build's zephyr.signed.bin, not a "
                        ".hex or an unsigned zephyr.bin")
    marker, what = MUST_CARRY[chip]
    if marker not in data and not force:
        raise ToolError(f"this image does not carry {what}. Flashed and confirmed, it would "
                        f"leave this half unreachable over USB. Rebuild it, or pass --force")


def image_state(smp):
    return smp.call(GROUP_IMG, IMG_STATE, OP_READ, timeout=10, retries=2).get("images", [])


def upload(smp, data, chunk, label):
    sha = hashlib.sha256(data).digest()
    off, t0, last = 0, time.time(), -1
    while off < len(data):
        body = {"off": off, "data": data[off:off + chunk]}
        if off == 0:
            body.update({"image": 0, "len": len(data), "sha": sha, "upgrade": False})
        rsp = smp.call(GROUP_IMG, IMG_UPLOAD, OP_WRITE, body,
                       timeout=60 if off == 0 else 15, retries=3)
        nxt = rsp.get("off")
        if nxt is None or nxt < off:
            raise ToolError(f"{label}: the unit answered offset {nxt} after {off}")
        off = nxt
        pct = off * 100 // len(data)
        if pct // 10 != last // 10:
            last = pct
            progress(f"{label}: uploaded {pct}% ({off // 1024} of {len(data) // 1024} KB, "
                     f"{time.time() - t0:.0f} s)")
    return time.time() - t0


def test_and_reset(smp, label):
    slot1 = next((i for i in image_state(smp) if i.get("slot") == 1), None)
    if not slot1 or not slot1.get("hash"):
        raise ToolError(f"{label}: no image in the second slot after the upload")
    smp.call(GROUP_IMG, IMG_STATE, OP_WRITE, {"hash": slot1["hash"], "confirm": False},
             timeout=10, retries=1)
    try:
        smp.call(GROUP_OS, OS_RESET, OP_WRITE, {}, timeout=3)
    except (TimeoutError, OSError):
        pass                                   # the reset may cut the answer; that is fine
    return bytes(slot1["hash"]), slot1.get("version")


def wait_confirmed(get_images, new_hash, timeout, label):
    t0, state = time.time(), None
    while time.time() - t0 < timeout:
        try:
            imgs = get_images()
            act = next((i for i in imgs if i.get("active")), None)
            if act and bytes(act.get("hash", b"")) == new_hash:
                state = "on-test"
                if act.get("confirmed"):
                    return "confirmed"
            elif act:
                state = "old-image-running"
        except (TimeoutError, PermissionError, OSError, ToolError):
            pass
        time.sleep(3)
    progress(f"{label}: not confirmed after {timeout} s (state: {state})")
    return state or "unreachable"


def update_ble(unit, path, force=False):
    data = open(path, "rb").read()
    check_image(data, "ble", force)
    unit.ensure_unlocked()
    before = unit.passport()
    try:
        buf = unit.ble.call(GROUP_OS, OS_PARAMS, OP_READ).get("buf_size", 1024)
    except PermissionError:
        buf = 1024
    chunk = max(256, min(768, buf - 256))
    secs = upload(unit.ble, data, chunk, "BLE half")
    new_hash, ver = test_and_reset(unit.ble, "BLE half")
    progress("BLE half: rebooting into the new image (the USB port drops and returns)")
    unit.close()
    wait_port(unit.sn, False, 15)
    if not wait_port(unit.sn, True, 120):
        raise ToolError("BLE half: the unit did not come back on USB within 120 s")
    time.sleep(2)
    again = Unit(port=None if unit.sn is None else find_ports()[unit.sn][0], key=unit.key)

    def imgs():
        if not again.unlocked:
            again.ensure_unlocked()
        return image_state(again.ble)
    state = wait_confirmed(imgs, new_hash, 180, "BLE half")
    after = again.passport()
    again.close()
    return {"ok": state == "confirmed", "chip": "ble", "state": state, "upload_s": round(secs),
            "before": before.get("ble_fw"), "after": after.get("ble_fw"),
            "build_before": before.get("build"), "build_after": after.get("build")}


def update_lte(unit, path, force=False):
    data = open(path, "rb").read()
    check_image(data, "lte", force)
    lte = unit.lte()
    before = lte.call(GROUP_SVC, SVC["passport"], OP_READ, timeout=10, retries=2)
    secs = upload(lte, data, 512, "LTE half")
    new_hash, ver = test_and_reset(lte, "LTE half")
    progress("LTE half: rebooting into the new image (about a minute: the swap, then the modem)")
    time.sleep(5)
    state = wait_confirmed(lambda: image_state(lte), new_hash, 300, "LTE half")
    after = lte.call(GROUP_SVC, SVC["passport"], OP_READ, timeout=10, retries=3)
    return {"ok": state == "confirmed", "chip": "lte", "state": state, "upload_s": round(secs),
            "before": before.get("lte_fw"), "after": after.get("lte_fw"),
            "build_before": before.get("build"), "build_after": after.get("build")}


# ── logs ──────────────────────────────────────────────────────────────────────────────────────

def logs(unit, chip, lines):
    smp = unit.smp(chip)
    got, frm, total = [], 0, None
    while total is None or (frm < total and len(got) < lines):
        r = smp.call(GROUP_SVC, SVC["logtail"], OP_READ, {"from": frm, "max": 8},
                     timeout=10, retries=2)
        total = r.get("total", 0)
        page = r.get("lines", [])
        if not page:
            break
        got += page
        frm += len(page)
    got = got[:lines]
    return list(reversed(got))                 # oldest first, like any log


# ── output ────────────────────────────────────────────────────────────────────────────────────

def jsonable(o):
    if isinstance(o, bytes):
        return o.hex()
    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, list):
        return [jsonable(v) for v in o]
    return o


def show(obj, as_json):
    if as_json:
        print(json.dumps(jsonable(obj), indent=2))
        return
    for k, v in obj.items():
        if isinstance(v, bytes):
            v = v.hex() if len(v) <= 32 else f"<{len(v)} bytes> {v[:16].hex()}..."
        print(f"  {k:18} {v}")


def doctor():
    out = {"python": sys.version.split()[0], "keyring": keyring_dir(),
           "owner_key": os.path.exists(default_key_path())}
    for mod in ("serial", "cryptography"):
        try:
            __import__(mod)
            out[mod] = "ok"
        except ImportError:
            out[mod] = "MISSING"
    try:
        out["units"] = find_ports()
    except ToolError as e:
        out["units"] = str(e)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["list", "passport", "health", "needs", "claim", "unlock",
                                    "lock", "owner", "owner-set", "owner-clear", "logs",
                                    "images", "update-ble", "update-lte", "keygen", "key-path",
                                    "doctor", "echo", "raw"])
    ap.add_argument("arg", nargs="?", help="update-*: the signed image (zephyr.signed.bin); "
                                          "echo: text")
    ap.add_argument("--port", help="the BLE service port (default: the only BLG20 on USB)")
    ap.add_argument("--key", help="PEM private key to unlock with (default: this PC's owner key)")
    ap.add_argument("--owner-key", help="owner-set: the NEW owner's PEM private key")
    ap.add_argument("--chip", choices=["ble", "lte"], default="ble")
    ap.add_argument("--lines", type=int, default=64)
    ap.add_argument("--group", type=int, default=GROUP_SVC)
    ap.add_argument("--id", type=int, default=0)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="update-*: flash an image that would leave the half unreachable over USB")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    try:
        if a.cmd == "list":
            units = find_ports()
            if a.json:
                print(json.dumps({"units": [{"serial": sn, "service_port": p[0],
                                             "lte_port": p[1] if len(p) > 1 else None}
                                            for sn, p in units.items()]}, indent=2))
            elif not units:
                print("no BLG20 on USB (VID 0x%04X PID 0x%04X)" % (VID, PID))
            for sn, p in units.items():
                if not a.json:
                    print(f"BLG20 {sn}: service={p[0]} lte-tunnel={p[1] if len(p) > 1 else '-'}")
            return 0
        if a.cmd == "key-path":
            show({"owner_key": default_key_path(),
                  "exists": os.path.exists(default_key_path())}, a.json)
            return 0
        if a.cmd == "keygen":
            show({"created": keygen(a.key or default_key_path())}, a.json)
            return 0
        if a.cmd == "doctor":
            show(doctor(), a.json)
            return 0

        unit = Unit(a.port, a.key)
        try:
            if a.cmd == "passport":
                if a.chip == "lte":
                    show(unit.lte().call(GROUP_SVC, SVC["passport"], OP_READ, timeout=10,
                                         retries=2), a.json)
                else:
                    show(unit.passport(), a.json)
            elif a.cmd == "needs":
                show(unit.ble.call(GROUP_SVC, SVC["needs"], OP_READ), a.json)
            elif a.cmd == "owner":
                show(unit.ble.call(GROUP_SVC, SVC["owner"], OP_READ), a.json)
            elif a.cmd == "claim":
                key = a.key or default_key_path()
                p = unit.passport()
                mine = os.path.exists(key) and \
                    unit.ble.call(GROUP_SVC, SVC["owner"], OP_READ).get("pub") == pub_bytes(key)
                if p.get("claimed"):
                    show({"ok": mine, "why": "already yours" if mine else
                          "already claimed by another key"}, a.json)
                    return 0 if mine else 2
                created = None
                if not os.path.exists(key):
                    created = keygen(key)
                r = owner_set(unit.ble, key)
                show({"ok": r.get("ok"), "why": r.get("why"), "key": key,
                      "key_created": created is not None}, a.json)
                return 0 if r.get("ok") else 2
            elif a.cmd == "unlock":
                unit.ensure_unlocked()
                show({"ok": True, "session_s": unit.passport().get("session_s")}, a.json)
            elif a.cmd == "health":
                unit.ensure_unlocked()
                show(unit.ble.call(GROUP_SVC, SVC["health"], OP_READ), a.json)
            elif a.cmd == "lock":
                show(unit.ble.call(GROUP_SVC, SVC["lock"], OP_WRITE), a.json)
            elif a.cmd == "owner-set":
                unit.ensure_unlocked()
                show(owner_set(unit.ble, a.owner_key), a.json)
            elif a.cmd == "owner-clear":
                unit.ensure_unlocked()
                show(unit.ble.call(GROUP_SVC, SVC["owner"], OP_WRITE, {"clear": True}), a.json)
            elif a.cmd == "logs":
                unit.ensure_unlocked()
                lines = logs(unit, a.chip, a.lines)
                if a.json:
                    print(json.dumps({"chip": a.chip, "lines": lines}, indent=2))
                else:
                    for ln in lines:
                        print(f"[-{ln.get('age_ms', 0) / 1000:9.1f} s] {ln.get('text', '')}")
            elif a.cmd == "images":
                if a.chip == "lte":
                    unit.ensure_unlocked()
                show({"chip": a.chip, "images": image_state(unit.smp(a.chip))}, a.json)
            elif a.cmd in ("update-ble", "update-lte"):
                if not a.arg or not os.path.isfile(a.arg):
                    raise ToolError(f"{a.cmd} needs the signed image file (zephyr.signed.bin)")
                r = (update_ble(unit, a.arg, a.force) if a.cmd == "update-ble"
                     else update_lte(unit, a.arg, a.force))
                show(r, a.json)
                return 0 if r["ok"] else 2
            elif a.cmd == "echo":
                show(unit.ble.call(GROUP_OS, OS_ECHO, OP_WRITE, {"d": a.arg or "hello"}), a.json)
            elif a.cmd == "raw":
                show(unit.ble.call(a.group, a.id, OP_WRITE if a.write else OP_READ), a.json)
        finally:
            unit.close()
    except (ToolError, PermissionError, TimeoutError, OSError, ValueError) as e:
        if a.json:
            print(json.dumps({"ok": False, "error": str(e)}))
        else:
            print(f"ERROR: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
