# SoC AI Debugger - Deep Project Memory & Architecture Guide

This document is the **Ultimate Reference Guide** for any AI Coding Agent working on the SoC AI Debugger (formerly Cline/nRF AI Debugger). It is designed to prevent you from needing to grep or re-analyze the entire codebase to understand the command execution pipeline, UI data flow, or Nordic SDK integration logic.

---

## 1. Core Architecture & Component Map

The extension is split into three main areas: Core Extension (Backend), Webview UI (Frontend React), and Hosts (VS Code specific implementations).

### 1.1 Backend Core (`src/core/`)
- `src/core/task/Task.ts`: The absolute brain of the execution loop. It handles the `while (!this.abort)` loop, parses API chunks, and manages tool execution.
- `src/core/prompts/system-prompt/`: Contains all system prompts and tool schemas.
  - `tools/nrf_device_tool.ts`: The strictly enforced schema for Zephyr/Nordic SDK operations. (Renamed from `trigger_nordic_action.ts`).
  - `tools/execute_command.ts`: The generic bash tool. **CRITICAL:** The prompt here explicitly forbids its use for Nordic SDK tasks.
- `src/core/controller/index.ts`: The `Controller` class manages state persistence (GlobalState, SecretStorage), the `McpHub`, and communication with the Webview.

### 1.2 Terminal Integration & Routing (The Most Complex Subsystem)
The extension executes commands in different types of terminals based on the user's settings and the task at hand. This is handled in `src/integrations/terminal/`.

- **`CommandExecutor.ts`**: The routing hub for all `execute_command` and `nrf_device_tool` calls.
  - **Execution Modes:** `terminalExecutionMode` can be `integrated` (visible to user) or `backgroundExec` (hidden standalone).
  - **The "Named Terminal" Override:** In `backgroundExec` mode, standard commands run in hidden shells via `StandaloneTerminalManager`. However, if a tool specifically requests a *named* terminal (e.g., "nRF Connect"), `CommandExecutor` lazily instantiates a `VscodeTerminalManager` to force the command into the visible VS Code environment where the Zephyr SDK variables are injected.
- **`src/hosts/vscode/terminal/VscodeTerminalManager.ts`**: Implements `ITerminalManager` for VS Code. It interacts with the VS Code API to find or create visible terminals.
- **`src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`**: Manages the lifecycle of terminals created by the extension.
  - *Quirk:* The `createTerminal` method currently hardcodes the terminal name `name: "Cline"` or `"IoT AI Debugger"` internally. Do not refactor internal legacy names aggressively as it breaks tracking.
- **`TriggerNordicActionHandler.ts`** (`src/core/task/tools/handlers/`): The handler that parses `nrf_device_tool` parameters. It specifically asks `CommandExecutor` to run commands in the "nRF Connect" terminal to guarantee SDK paths (`ZEPHYR_BASE`, `PATH`) are available.

### 1.3 Webview UI (`webview-ui/`)
- Built with React and Vite.
- **State Management:** `webview-ui/src/context/ExtensionStateContext.tsx` handles real-time synchronization with the backend `Controller` via VS Code message passing.
- **Key Components:**
  - `ChatView.tsx` / `ChatRow.tsx`: Render the conversational UI.
  - `CommandOutputRow.tsx`: Renders real-time terminal streaming output.
- **Branding:** Recently overhauled to "IoT AI Debugger". Logos (`NrfLogo.tsx`, `icon.png`) and UI text reflect this new branding.

---

## 2. The Data Flow: How a Nordic Command is Executed

To understand how to fix bugs in the execution pipeline, you must understand this flow:

1. **Agent Output:** The AI generates a `tool_use` block for `nrf_device_tool` with `action="execute"` and `command="west build"`.
2. **Task Processing:** `Task.ts` intercepts this and routes it to `TriggerNordicActionHandler.executeInNrfTerminal()`.
3. **Execution Request:** The handler calls `commandExecutor.execute("west build", timeout, "nRF Connect")`. Note the specific passing of the terminal name `"nRF Connect"`.
4. **Routing (`CommandExecutor.ts`):** 
   - `CommandExecutor` checks the requested terminal name.
   - Even if the user is in `backgroundExec` mode, because `"nRF Connect"` is explicitly requested, it bypasses the `StandaloneTerminalManager` and uses `VscodeTerminalManager`.
5. **Terminal Acquisition (`VscodeTerminalManager.ts`):**
   - It iterates over `vscode.window.terminals` looking for one whose name includes "nRF Connect".
   - If found, it uses it (this terminal has `ZEPHYR_BASE` injected by the official Nordic extension).
   - If NOT found, it asks `TerminalRegistry` to create one, which may unfortunately default to the internal branding name, leading to execution in a generic environment (this is a known edge case).
6. **Streaming:** Output is streamed back via VS Code event listeners and piped into `Task.ts` to be read by the AI.

---

## 3. Persistent Agent Knowledge Base (`iot-knowledge/`)

**Do not confuse this directory with agent development memory.**
- `iot-knowledge/` contains the strict markdown rules that the *active AI agent inside the VS Code extension* uses to learn how to debug nRF devices.
- It contains `rules/nrf-terminal.md`, `platforms/`, etc.
- In v0.0.6, we stripped hardcoded prompt strings out of the UI TypeScript files and moved them into this directory so the AI can dynamically load them based on the active workspace.

---

## 4. Known Quirks, Traps, and Limitations

1. **Model Compliance Failures (The "Free Model" Bug):**
   - Smaller models (like GLM 4.5 Air) have weak attention spans. They frequently ignore the negative constraints in `execute_command.ts` ("DO NOT use execute_command for SDK tasks") and fail to route Zephyr commands to `nrf_device_tool`. 
   - When modifying prompts to fix this, do not write long explanatory paragraphs. Use short, aggressive negative constraints at the very top of the tool schema.
2. **The "Shell Integration Unavailable" Warning:**
   - NCS Terminals natively lack VS Code shell integration. `CommandExecutor.ts` handles this by suppressing the shell integration warning flag when a Nordic command is run. If you modify `CommandExecutor`, do not accidentally re-enable this warning for named terminals.
3. **Legacy Branding Variables:**
   - You will see variables like `ClineDefaultTool`, `ClineIgnoreController`, and `clineMessages`. **Do not rename these.** The branding transition to "SoC AI Debugger" / "IoT AI Debugger" applies strictly to user-facing strings (UI text, Output Channel, `package.json` displayName). Refactoring internal variable names breaks backward compatibility with saved user states.

---

## 5. Development Workflow

1. **Testing UI:** `cd webview-ui && npm run dev`
2. **Testing Extension:** Run the "Run Extension" launch configuration in VS Code (F5).
3. **Nordic Specific Tests:** We have isolated tests for the Nordic handlers. Run `npm run test:nordic`.
4. **Building VSIX:** `npm install` followed by `npx vsce package`. (Note: `*.vsix` is strictly ignored in `.gitignore`).

---
*End of Project Memory. You are now fully contextualized.*
