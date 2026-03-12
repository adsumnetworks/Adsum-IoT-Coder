# Changelog

All notable changes to the **SoC AI Debugger** extension will be documented in this file.

## [0.0.2] - 2026-03-02

### Fixed
- **Terminal Warning Suppression:** Removed the annoying "Shell Integration Unavailable" warning for nRF Connect terminals.
- **Background Execution:** Fixed a critical bug where named terminals (e.g., nRF Connect) were routed to hidden `cmd.exe` processes instead of the proper PowerShell terminal when the terminal execution mode was set to "Background Exec". This ensures `nrfutil` and `west` commands work reliably.
- **Terminal Timeout:** Increased the shell integration timeout to ensure slower PCs (e.g., Windows 10) have enough time to initialize the nRF Connect SDK environment before executing commands.

## [0.0.1] - Initial Release

### Added
- Initial release of SoC AI Debugger!
- Seamless integration with the nRF Connect SDK terminal in VS Code.
- AI-powered assistant for Zephyr-based projects capable of automatically analyzing UAR/RTT logs, executing Nordic toolchain commands, and debugging code.