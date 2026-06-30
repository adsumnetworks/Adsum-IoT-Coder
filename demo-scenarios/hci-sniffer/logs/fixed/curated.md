# HCI + Sniffer — curated decisive evidence (FIXED run)
# After adding bt_nus_subscribe_receive(&nus) in discovery_complete().
# Faithful slices of the real decoded fixed captures in this folder.

## App layer (central RTT) — still ends at discovery
central_uart: Connected: C3:C3:C8:32:C0:D5 (random)
central_uart: MTU exchange done
central_uart: Service discovery completed
# The app log alone looks the same — the proof of the fix is at the deeper layers:

## HCI layer (host <-> controller, central) — 115 frames, 0 parse errors, 9.4 s
#73  host -> ctrl  ACL_TX   7B
#79  host -> ctrl  ACL_TX  27B   (the subscribe write goes out)
#81  ctrl -> host  ACL_RX   9B   (notifications now flowing back)
#84  ctrl -> host  ACL_RX  10B
# DECISIVE: 22 ACL data frames (was 3) — the CCCD subscribe + a stream of inbound
#           notification packets. The data plane is alive.

## Over-the-air (nRF Sniffer) — 124 frames, 0 undecoded
# DECISIVE: 25 DATA PDUs (was 4) — the peripheral->central notifications are now
#           transmitting over the air. Same boards, one line of code.
