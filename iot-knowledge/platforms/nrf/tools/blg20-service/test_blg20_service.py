#!/usr/bin/env python3
"""
Offline tests for blg20_service.py — no USB device, no owner key required.

Covers the four pieces that are wrong-once-and-quiet if they break: the CRC used to frame every
SMP packet, the SMP serial encode/decode round trip, the P-256 sign/verify round trip that backs
`claim`/`unlock`, and the Linux/Windows port-interface parsing in `find_ports()` that tells the BLE
service port apart from the LTE tunnel port.

Run: python -m unittest discover -s iot-knowledge/platforms/nrf/tools/blg20-service -p 'test_*.py'
  or: python -m pytest iot-knowledge/platforms/nrf/tools/blg20-service/test_blg20_service.py
"""
import importlib.util
import os
import shutil
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "blg20_service.py")


def load():
    spec = importlib.util.spec_from_file_location("blg20_service_under_test", SRC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


blg20 = load()


class FakeSerial:
    """Stands in for `serial.Serial` — a byte pipe with no real port behind it."""

    def __init__(self):
        self.written = bytearray()
        self._feed = bytearray()
        self.dtr = False

    def write(self, data):
        self.written += data

    def read(self, n=1):
        if not self._feed:
            return b""
        chunk = bytes(self._feed[:n])
        del self._feed[: len(chunk)]
        return chunk

    def reset_input_buffer(self):
        pass

    def close(self):
        pass


def make_smp():
    """An Smp instance with a FakeSerial, bypassing __init__ (which opens a real port)."""
    smp = blg20.Smp.__new__(blg20.Smp)
    smp.ser = FakeSerial()
    smp.seq = 0
    smp.timeout = 5.0
    return smp


class Crc16Xmodem(unittest.TestCase):
    def test_check_value(self):
        # The standard CRC-16/XMODEM check value for the ASCII string "123456789".
        self.assertEqual(blg20.crc16_xmodem(b"123456789"), 0x31C3)

    def test_empty_input_is_zero(self):
        self.assertEqual(blg20.crc16_xmodem(b""), 0)


class SmpFramingRoundTrip(unittest.TestCase):
    """Smp._send() writes a framed line; Smp._recv() must decode exactly what was written."""

    def test_send_then_recv_returns_the_same_packet(self):
        smp = make_smp()
        payload = b"blg20 smp framing round trip \x00\x01\xff"
        smp._send(payload)
        # Loop the bytes the "wire" would have carried back into the read side.
        smp.ser._feed = bytearray(smp.ser.written)
        got = smp._recv(timeout=2.0)
        self.assertEqual(got, payload)

    def test_recv_rejects_a_corrupted_crc(self):
        smp = make_smp()
        smp._send(b"hello")
        corrupted = bytearray(smp.ser.written)
        corrupted[-3] ^= 0xFF  # flip a byte inside the base64 payload
        smp.ser._feed = corrupted
        with self.assertRaises(TimeoutError):
            smp._recv(timeout=0.3)


class KeygenSignVerifyRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.key_path = os.path.join(self.tmp, "owner-test.pem")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_keygen_then_sign_verifies_against_its_own_public_key(self):
        created = blg20.keygen(self.key_path)
        self.assertEqual(created, self.key_path)
        self.assertTrue(os.path.exists(self.key_path))

        msg = b"blg20-service test challenge"
        sig = blg20.sign_raw(self.key_path, msg)
        self.assertEqual(len(sig), 64, "raw ECDSA P-256 signature must be r(32) || s(32)")

        pub = blg20.pub_bytes(self.key_path)
        self.assertEqual(len(pub), 65, "uncompressed SECP256R1 point is 1 + 32 + 32 bytes")
        self.assertEqual(pub[0], 0x04)

        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

        with open(self.key_path, "rb") as f:
            priv = serialization.load_pem_private_key(f.read(), password=None)
        r = int.from_bytes(sig[:32], "big")
        s = int.from_bytes(sig[32:], "big")
        der = encode_dss_signature(r, s)
        priv.public_key().verify(der, msg, ec.ECDSA(hashes.SHA256()))  # raises if invalid

    def test_keygen_never_overwrites(self):
        blg20.keygen(self.key_path)
        with self.assertRaises(blg20.ToolError):
            blg20.keygen(self.key_path)


class FindPortsParsing(unittest.TestCase):
    """find_ports() must tell service (iface 0) and LTE-tunnel (iface 2) ports apart."""

    def _fake_port(self, **kw):
        base = dict(vid=blg20.VID, pid=blg20.PID, product=blg20.PRODUCT, description="BLG20 Gateway",
                    location=None, hwid="", serial_number="SN1")
        base.update(kw)
        return mock.Mock(**base)

    def test_linux_location_splits_service_from_lte(self):
        ports = [
            self._fake_port(location="1-2:1.0", device="/dev/ttyACM0", serial_number="LNX1"),
            self._fake_port(location="1-2:1.2", device="/dev/ttyACM2", serial_number="LNX1"),
        ]
        with mock.patch.object(blg20.serial.tools.list_ports, "comports", return_value=ports):
            units = blg20.find_ports()
        self.assertEqual(units["LNX1"], ["/dev/ttyACM0", "/dev/ttyACM2"])

    def test_windows_hwid_mi02_sorts_after_mi00(self):
        ports = [
            self._fake_port(location="", hwid=r"USB\VID_1209&PID_0001&MI_00\7&2A1B3C&0&0000",
                             device="COM5", serial_number="WIN1"),
            self._fake_port(location="", hwid=r"USB\VID_1209&PID_0001&MI_02\7&2A1B3C&0&0002",
                             device="COM7", serial_number="WIN1"),
        ]
        with mock.patch.object(blg20.serial.tools.list_ports, "comports", return_value=ports):
            units = blg20.find_ports()
        self.assertEqual(units["WIN1"], ["COM5", "COM7"])

    def test_wrong_vid_pid_is_ignored(self):
        ports = [self._fake_port(vid=0x0000, pid=0x0000, device="COM9", serial_number="OTHER")]
        with mock.patch.object(blg20.serial.tools.list_ports, "comports", return_value=ports):
            units = blg20.find_ports()
        self.assertNotIn("OTHER", units)


class BuiltInCbor(unittest.TestCase):
    """The tool carries its own CBOR codec (no cbor2 install on a customer's PC)."""

    def test_round_trip(self):
        cases = [{}, {"d": "hello"},
                 {"off": 70000, "data": bytes(range(256)) * 3, "upgrade": False, "len": 5000000},
                 {"images": [{"slot": 0, "hash": b"\x01\x02", "confirmed": True}]},
                 {"n": -5, "big": 2 ** 40, "nest": [1, [2, [3]]], "text": "é€"}]
        for c in cases:
            self.assertEqual(blg20.cbor_loads(blg20.cbor_dumps(c)), c)

    def test_zephyr_indefinite_containers(self):
        # zcbor answers SMP requests with indefinite-length maps: 0xBF ... 0xFF
        self.assertEqual(blg20.cbor_loads(bytes.fromhex("bf61726568656c6c6fff")), {"r": "hello"})
        self.assertEqual(blg20.cbor_loads(bytes.fromhex("9f0102ff")), [1, 2])

    def test_image_guard(self):
        with self.assertRaises(blg20.ToolError):
            blg20.check_image(b":10000000", "ble", False)          # an Intel HEX file
        with self.assertRaises(blg20.ToolError):
            blg20.check_image(blg20.MCUBOOT_MAGIC + b"\x00" * 64, "ble", False)
        blg20.check_image(blg20.MCUBOOT_MAGIC + b"BLG20 Gateway", "ble", False)
        blg20.check_image(blg20.MCUBOOT_MAGIC, "lte", True)            # --force


if __name__ == "__main__":
    unittest.main()
