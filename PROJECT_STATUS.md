# Nordic Auto-Debugger: Comprehensive Project Status

## 🌟 Project Overview
The **Nordic Auto-Debugger** is a specialized enhancement of the Cline agent, optimized for embedded development on nRF52 series microcontrollers using the Zephyr RTOS. It transforms the general-purpose coding assistant into an expert firmware engineer capable of autonomous debugging, flashing, and testing.

## 🏗 Core Architecture: "Brain" & "Hands"
The system relies on a two-part architecture to bridge the gap between LLM reasoning and hardware reality.

### 🧠 The Brain (System Prompt & Logic)
- **Role**: Expert Embedded Engineer.
- **Capabilities**: Understoods Zephyr build systems (`west`), device-tree overlays, and SEGGER RTT/UART logging nuances.
- **Intelligence**:
  - **Smart Dispatch**: Automatically detects if a device identifier is a Serial Number (J-Link) or a Port (`/dev/ttyACM*`) and selects the correct transport (`rtt` vs `uart`).
  - **Safety First**: Conditioned to ask before performing disruptive actions like flashing or rebooting active devices.

### 👐 The Hands (Tooling & Scripts)
- **`trigger_nordic_action`**: The primary interface for the agent to interact with hardware.
- **Unified Logging Backend** (`assets/scripts/`):
  - **`uart-logger`**: Robust serial port capture wrapper.
  - **`rtt-logger`**: Advanced J-Link RTT capture wrapper with threaded real-time timestamping.

---

## ✅ Completed Features

### 1. Robust Logging System
We have achieved a stable, production-grade logging pipeline for multi-device environments.
- **Unified Interface**: Both RTT and UART loggers now support the same CLI arguments (`--port`, `--name`, `--duration`), simplifying the agent's decision-making.
- **Real-Time Correlation**: 
  - **UART**: Naturally timestamped by the host.
  - **RTT**: Now features a threaded post-processor that injects `[HH:MM:SS.mmm]` wall-clock time into J-Link RTT streams, allowing perfect correlation between Central and Peripheral logs.
- **Process Robustness**:
  - Aggressive stale process cleanup (kills orphaned `JLinkRTTLogger` or `nrfjprog` instances).
  - Explicit device reset sequence to prevent J-Link handle locking.

### 2. Extension Intelligence
- **Smart Transport Detection**: The extension logic (`TriggerNordicActionHandler.ts`) now acts as a safety net. If the agent provides a 9-digit serial number but forgets to specify `transport="rtt"`, the system automatically corrects it.
- **User Feedback**: The tool UI clearly indicates the active mode: `Nordic Logger [RTT]` or `Nordic Logger [UART]`.

### 3. Verification & CI Speed
- **Unit Testing**: 779 unit tests are currently passing, covering all dispatch logic, parameter parsing, and error handling.
- **Hardware Verified**: Validated on nRF52840 DKs (Central + Peripheral) with simultaneous log capture.

---

## 🚧 Roadmap & Remaining Tasks

### Short Term (Next Session)
- [ ] **Board Name Standardization**: Enforce `nrf52840dk/nrf52840` naming conventions in the system prompt to prevent `west build` errors.
- [ ] **Build Folder Logic**: Update build tools to intelligentlly select `app/build/` (NCS standard) vs generic `build/`.
- [ ] **Log Separation**: Explicitly separate captured artifacts into `uart-logs/` and `rtt-logs/` directories for better organization.
- [ ] **Safety Enforcement**: Hard-code rules in the system prompt requiring user approval for `reboot` and `flash` commands.

### Long Term
- **Automated Flashing**: reliable multi-board flashing via `nrfjprog` with serial number targeting.
- **Panic Analysis**: Automated parsing of Zephyr crash dumps (Stack traces, HardFaults) from logs.

---

## 📂 Key File Locations

| Component | Path | Description |
|-----------|------|-------------|
| **Handler Logic** | `src/core/task/tools/handlers/TriggerNordicActionHandler.ts` | The "Brain" logic for dispatch and smart detection. |
| **Tool Definition** | `src/core/prompts/system-prompt/tools/trigger_nordic_action.ts` | The definition exposed to the LLM. |
| **RTT Script** | `assets/scripts/nrf_rtt_logger.py` | The threaded RTT logger with timestamping. |
| **UART Script** | `assets/scripts/nrf_uart_logger.py` | The serial port logger. |
| **Wrappers** | `assets/scripts/uart-logger`, `rtt-logger` | CLI entry points for the scripts. |

This document represents the full status of the project as of **February 4, 2026**.
