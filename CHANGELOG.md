# Changelog

All notable changes to the **IoT AI Debugger** extension will be documented in this file.

## [0.0.4] - 2026-03-23

### Changed
- **Major Rebrand:** Extension renamed from "nRF AI Debugger" to **IoT AI Debugger – for nRF**.
- **Repository Move:** All internal links and configuration updated to point to the new repository at [https://github.com/adsumnetworks/SoC-AI-Debugger](https://github.com/adsumnetworks/SoC-AI-Debugger).

### Added
- **PostHog Analytics:** Integrated PostHog to track anonymous usage data and Nordic toolchain errors, helping us identify missing dependencies or environmental issues automatically.
- **Compliance:** Added official trademark disclaimer for nRF and Nordic Semiconductor compliance.

### Fixed
- **Log Analyzer Reliability:** Significant improvements to cross-platform UART and RTT log capture stability.
- **Terminal Routing:** Fixed a bug where named terminals (nRF Connect) were incorrectly routed to hidden `cmd.exe` processes in background execution mode.

## [0.0.2] - 2026-03-02

### Fixed
- **Terminal Warning Suppression:** Removed the annoying "Shell Integration Unavailable" warning for nRF Connect terminals.
- **Background Execution:** Fixed a critical bug where named terminals (e.g., nRF Connect) were routed to hidden `cmd.exe` processes instead of the proper PowerShell terminal when the terminal execution mode was set to "Background Exec". This ensures `nrfutil` and `west` commands work reliably.
- **Terminal Timeout:** Increased the shell integration timeout to ensure slower PCs (e.g., Windows 10) have enough time to initialize the nRF Connect SDK environment before executing commands.

## [0.0.1] - Initial Release

### Added
- Initial release of IoT AI Debugger!
- Seamless integration with the nRF Connect SDK terminal in VS Code.
- AI-powered assistant for Zephyr-based projects capable of automatically analyzing UAR/RTT logs, executing Nordic toolchain commands, and debugging code.