---
id: adsum/nrf/tools/board-shell
title: "board-shell"
type: tool
version: 1.0.0
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
runtime: python3
entry: board_shell.py
usage: '--port <PORT> --cmd "<COMMAND>"'
safety: [shell]
readonly: false
artifacts:
  - path: board-shell
    sha256: 37ba78b0c20b365eeb01a858234aaaaad67c91ad7d250cd22b283667914efcc8
  - path: board-shell.bat
    sha256: c118ee175773f7e59b2094891b65a7432fb831415430ed72737b337df9db7352
  - path: board_shell.py
    sha256: c58b776de2a8d37886db1d4ce339e14d0c450b6b2023db74ff152360ddbba20c
  - path: test_board_shell.py
    sha256: 21fa1bf0c2a027ce573eb984dbf1ede484ab48ce70af3a1f9575a71382c1154c
---

Open an interactive serial session with a board and send it a command, returning what it replies. Use this to talk to a device — AT commands, a shell prompt, a bootloader — rather than only listening to what it emits.
