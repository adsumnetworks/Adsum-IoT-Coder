# Changelog

All notable changes to the **Adsum IoT Coder** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.2] - 2026-10-18

### Fixed
- Windows: the Hardware page finds BLG20x and LBG20x gateways over Bluetooth again. The Python included for Windows lacked a module its Bluetooth part needs, so every scan failed.
- The Hardware page's firmware download: with no folder open it asks where to keep the release (it looked like nothing happened), and a release downloaded into a folder you chose is listed and can be flashed (the page kept offering Download).

### Changed
- One package for every system. The first time you use a gateway, Adsum IoT Coder sets up the Python its gateway tool needs on your computer (once, about a minute), checks it before each use and repairs it by itself if it breaks. If it cannot, the Hardware page says why and offers Retry; **Adsum: Repair Bluetooth support** rebuilds it.

## [0.5.1] - 2026-10-11

### Added
- Gateways over Bluetooth: the Hardware page finds a Fanstel BLG20x or LBG20x in range, pairs with it, claims it and checks its firmware against the latest release.
- Firmware updates over Bluetooth for both halves of a gateway, keeping its settings.
- Commission a gateway from a session. Each setting is written to the unit and read back, and a site profile reuses your answers for the next unit.
- Demo and licensed firmware download into your workspace with their licence, and flash from there.

### Changed
- The extension includes the Python its tools need on every platform.

## [0.5.0] - 2026-10-10

### Added
- Sessions as editor tabs: open several side by side, each with its own run, listed in the sidebar.
- What can you ask (⌘K or Ctrl+K): runs, journeys, checks and samples, the ones for your desk first.
- Licensed firmware and source download per version into your workspace.
- Slash commands anywhere in a message, and an MCP server's prompts as slash commands.
- The Fanstel LBG20x is recognised over USB.

### Changed
- A simpler sidebar, with details shown on hover.
- A tool call that keeps failing now stops and asks you.

### Removed
- Some inherited commands, and the built-in MCP marketplace.

## [0.4.6] - 2026-10-09

### Added
- The Fanstel BLG20x over its USB-C service port: identify the unit, claim it and offer the latest demo firmware.

### Changed
- Log tools no longer end other programs' debugger sessions.
- The BLG20x card names Wi-Fi where the module is fitted.

### Fixed
- Downloaded tools stay executable on Linux and macOS.
- Terminal commands no longer wait on a pager.

## [0.4.3] - 2026-09-30

### Added
- LoRa and LoRaWAN for nRF and ESP32 boards, with a free account, including time-on-air and duty-cycle checks.

## [0.4.2] - 2026-09-17

### Changed
- A smaller extension package.

## [0.4.1] - 2026-09-17

### Added
- A guided first run for the Fanstel BLG20x gateway.
- Cellular demo images for the Fanstel LEW840x.
- Your account in the panel header.
- OpenRouter: choose which sellers may serve a model, with price ceilings.

### Fixed
- Tasks no longer slow down while the editor window is hidden.
- A reply that stalls is retried once, then reported clearly.
- Sign-in finishes in the window that started it.

## [0.4.0] - 2026-09-09

### Added
- A redesigned home that shows your folder, your boards and toolchains, and what to do next.
- A free account (GitHub or email, no card) opens cellular, satellite NB-NTN and on-device inference.
- You can send a message to a session while it works.
- Set your own model prices.
- A check before flashing on nRF that catches an image that would not boot.

### Fixed
- The thinking depth you choose is honoured for DeepSeek and GLM, and the reasoning-effort setting for OpenAI models.
- Model costs are reported correctly.
- Sign-in works from Remote-SSH windows, codespaces and dev containers.

## [0.3.1] - 2026-08-26

### Added
- nRF91 cellular: NB-IoT, LTE-M, NB-NTN and DECT NR+, and GNSS positioning.
- Board knowledge for the nRF9160, nRF9161 and nRF9151 DKs, and the Fanstel LEW840X.
- A board shell for AT and Zephyr shell commands, and modem trace decoding.

### Fixed
- The ESP monitor no longer drops the chip into the bootloader when it opens the port.
- Log and code search, and native modules on Windows.

## [0.2.1] - 2026-08-17

### Added
- Project memory in an `.adsum/` folder.
- Search across RTT, UART, HCI and sniffer logs.
- nRF54L15 and nRF54LM20 board knowledge, and an nRF52840 to nRF54L migration guide.
- DeepSeek as a native provider.
- Export a session as one redacted file.

### Fixed
- More reliable handling of long sessions.

## [0.2.0] - 2026-07-21

### Added
- Build a complete two-chip gateway from one specification.
- A model picker with the free tier, the GLM Coding Plan, Claude and other providers.
- Curated knowledge names the engineer who wrote it.
- Published to Open VSX, for Cursor, Windsurf and VSCodium.

### Fixed
- ESP-IDF version detection.
- Stop now interrupts a command that hangs.

## [0.1.8] - 2026-07-07

### Added
- Three-layer BLE debug: application log, HCI and over-the-air sniffer, correlated.
- A slimmer input box.

### Fixed
- ESP SBOM generation on ESP-IDF 5.x, and the terminal on fresh Windows installs.

## [0.1.7] - 2026-06-24

### Added
- A CRA readiness check on nRF and ESP, with an SBOM in SPDX, a secure-by-design check and advisories for your SDK, written to a `compliance/` folder.
- HCI decoding, and an nRF terminal that follows your project's SDK version.

## [0.1.6] - 2026-06-16

### Added
- ESP32 and ESP-IDF support, with automatic platform detection and new ESP-IDF projects.

### Fixed
- Board and toolchain detection on Windows, and ESP-IDF version selection.

## [0.1.5] - 2026-06-08

### Added
- A first-run demo on a real BLE bug.
- The free tier is on by default, with nothing to set up.
- A home screen that suggests the next step.
- Test and validate on Windows and macOS.

### Fixed
- The free-tier token counter, and `nrfutil` detection on Windows.

## [0.1.3] - 2026-06-01

### Added
- A built-in free tier that needs no API key, account or card.
- Switch to your own API key at any time, even during a task.

## [0.1.2] - 2026-05-31

### Changed
- A smaller download.

### Fixed
- Icons on Linux.

## [0.1.0] - 2026-05-26

### Added
- Knowledge matched to your project.
- An open benchmark, IoT-FirmwareDebugBench v0.1.
- A new home screen.

## [0.0.4] - 2026-03-23

### Changed
- Renamed from nRF AI Debugger to Adsum IoT Coder.

### Fixed
- UART and RTT log capture reliability.

## [0.0.2] - 2026-03-02

### Fixed
- nRF Connect terminal routing and warnings.

## [0.0.1]

### Added
- First release: an assistant for nRF Connect SDK projects that analyses UART and RTT logs and runs the Nordic toolchain.
