# HCI + Sniffer — curated decisive evidence (BUGGY run)
# Faithful slices of the real decoded captures in this folder. Full traces are the
# sibling .hci.log / .sniffer.log / .pcap — open those (or Wireshark) for the rest.
# The bug: central never calls bt_nus_subscribe_receive() → no CCCD subscribe →
# the peripheral's notifications are silently dropped.

## App layer (central RTT) — BLIND to the bug
central_uart: Connected: DB:96:E9:19:7C:47 (random)
central_uart: Security changed: ... level 2
central_uart: MTU exchange done
central_uart: Service discovery completed
# ...then nothing. No data, no error. The app log cannot see why data isn't arriving.

## HCI layer (host <-> controller, central) — 51 frames, 0 parse errors, 16.4 s
#45  host -> ctrl  ACL_TX  16B   (the discovery exchange)
#47  ctrl -> host  ACL_RX  10B   (the discovery exchange)
# DECISIVE: only 3 ACL data frames in the whole capture — the discovery handshake and
#           nothing after. No subscribe is written; no notification packets come back.
# (The peripheral IS producing data — "farm_sensor: Battery level: 100%" every ~5 s —
#  but it never reaches the central.)

## Over-the-air (nRF Sniffer) — 327 frames, 0 undecoded, 11.3 s
#1  ch37  ADV_NONCONN_IND from 3f:88:cb:1e:e4:7a   (advertising)
# DECISIVE: only 4 DATA PDUs in 327 frames — the rest are ADV + empty keep-alives.
#           Almost nothing is transmitted: no peripheral->central notifications on air.
