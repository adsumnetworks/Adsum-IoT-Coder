---
id: adsum/rules/core
title: "Universal Embedded Rules"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: universal
---

# Universal Embedded Rules

These rules apply universally to any IoT or Embedded project context, regardless of platform or SDK.

## 1. Project Analysis
- **Always Validate Build State:** Before debugging code, ensure the project builds correctly.
- **Artifact Awareness:** Check for the existence of build directories and artifacts (`.hex`, `.bin`, `.elf`).

## 2. Hardware Debugging
- **Never guess communication parameters:** If a serial port or baud rate is required, check the project configuration or ask the user.
- **Logs are truth:** Rely on device logs (UART/RTT/SWO) before analyzing source code logic when debugging runtime issues.

## 3. Configuration First
- Start debugging by examining configuration files and overlays.
- In embedded systems, peripheral allocation (DeviceTree) and enabled features (Kconfig) usually cause more issues than raw C/C++ code.

## 4. Flash Safety
- Assume all flash operations are disruptive.
- Never flash a device without confirming the target board model and connection state.

## 5. Proactive Action via Buttons (Global UX Rule)
Any high-value recommendation that involves a hardware interaction or significant action MUST be presented as clickable buttons using `ask_followup_question` with the `options` parameter. Do NOT present recommendations as plain text that requires the user to type a response.

**The principle:** After completing any significant action, write 1-2 sentences summarizing what was done and offering a key insight or recommendation, then immediately present the next logical step(s) as buttons. Do NOT ask open-ended questions like "What would you like to do next?"

**CRITICAL XML TOOL USAGE RULE:** 
Never nest tool calls. Do NOT place the `<ask_followup_question>` tool inside the text payload of an `<attempt_completion>` block. 
If you are offering next-step buttons (which means the workflow is logically continuing), you MUST use the `ask_followup_question` tool **INSTEAD** of `attempt_completion`. Use `attempt_completion` ONLY when you are completely terminating the interaction with no further buttons.

This pattern applies to ALL platforms for actions such as:
- Suggesting a configuration change (log backend, protocol settings)
- Offering to Build / Flash
- Suggesting to capture device logs
- Recommending deeper debugging or additional instrumentation
- Post-analysis next steps

## 6. Chat Formatting Rules
- **Use Markdown Tables:** When comparing configurations, listing error codes, or summarizing device states, use Markdown tables to make the data highly scannable and easy to read.
- **Code blocks** are fine and encouraged for commands, config, and log excerpts.
- **Bold key terms** to make summaries scannable.
- **Diagrams (Mermaid):** When a relationship is clearer drawn than written, render a Mermaid diagram fenced as ```mermaid — it renders live in the chat. Reach for it for a **multi-device / connection timeline** (sequence diagram — e.g. a BLE central ↔ peripheral connect + GATT notify), a **project component map** (flowchart — e.g. BLE + sensor + storage modules), or a **state machine** (state diagram). When the diagram represents a design decision (new-app architecture, protocol flow), **show it and get the user's confirmation BEFORE implementing**. Keep diagrams focused — a few nodes, not exhaustive.
  - **Mermaid syntax trap:** never put a literal `\n` inside a node label or message — Mermaid renders it as the two characters `\n`, not a line break. Keep labels single-line (preferred) or use `<br/>` for an intentional break.

## 7. Tool Usage Priority (Embedded Development)
- **Prefer reading tools over shell commands:** For file inspection, use `read_file`, `search_files`, `list_files` instead of running `cat`, `grep`, or `ls` in a terminal.
- **Prefer platform tools for device commands:** Use platform-specific device tools (e.g., `nrf_device_tool`) instead of `execute_command` for any SDK-related task.
- Reserve `execute_command` (standard terminal) only for operations that genuinely require it: `git`, `pip`, `apt`, general host OS tasks.

## 8. Skill Discovery Protocol (Architecture & Optimization)
Advanced workflows and actions are documented as `.md` files in the `iot-knowledge` directory (indexed in `PLATFORM.md`). 

- **Entry-Point Hierarchy (Workflows vs Actions):** Always start a task by loading a Primary Workflow. "Actions" are internal subroutines and must NEVER be loaded as the first step of a task. You may only load an Action if an active Workflow explicitly instructs you to do so.
- **Mandatory First Load (via `read_file`):** You **MUST** proactively use `read_file` or `view_file` to load the required skill manual from the disk before executing. Do not attempt to execute complex tasks (like analyzing logs, generating code, building and flashing etc.) based on your pre-trained knowledge or general assumptions. There is no `load_workflow` tool; "loading" simply means reading the markdown file.
- **Context Optimization (Load Once):** If you have *already loaded* a specific skill file during the current ongoing task (for example, you are repeating an iteration in a debug loop), **DO NOT load it again**. Rely on the instructions already present in your conversational history to save context limits. Only load a file if it is missing from your immediate context.

## 9. Context Budget Protection

- **Workspace-only reads:** Only read files inside workspace roots listed in `environment_details`. NEVER scan `~/Desktop`, `~/Documents`, `~/Downloads`, or home directories.
- **NCS files only:** Only read files matching the NCS pattern: `CMakeLists.txt`, `prj.conf`, `*.conf`, `*.overlay`, `*.c`, `*.h`, `*.dts`, `*.yml`, `*.log`. NEVER open `.py`, `.js`, `.ts`, `.json`, `.md` files outside of `iot-knowledge/`.
- **No speculative reads:** Do NOT read files "just to understand the workspace". Read a file only when a workflow or rule explicitly instructs you to.
- **Stop on empty workspace:** If `environment_details` shows no workspace root, or the root contains no NCS markers — stop immediately and apply the Scope Gate (see `AGENT.md`).

## 10. No Decorative Shell Output, No GUI Launches

Never invoke `execute_command` (or any shell tool) solely to print completion text, status banners, or summaries. The shell is for operations that have side effects (creating files, killing processes, capturing logs) — not for narrating the conversation.

**Never launch GUI applications or windows to "show" the user a result** — no `start "" <folder>`, `explorer.exe`, `open`, `xdg-open`, or `code <folder>`. After a task completes (especially after scaffolding a project), state the **absolute path** in chat — paths are clickable; an explorer window popping up is intrusive and breaks trust. Same applies before completion: the deliverable is the chat summary plus paths, never a spawned window.

**Do NOT do this:**
- `echo "Analysis complete. See report above."`
- `echo "Done!"`
- `printf "Build successful\n"`
- `Write-Host "Cleanup done"`
- `cmd /c "echo Task finished"`
- `start "" "C:\Users\me\my-project"` (after scaffolding — just print the path)

**Do this instead:** Write the completion text directly in your response as plain markdown, then call `attempt_completion` (or `ask_followup_question` if you're offering next-step buttons). A `Cleanup done`-style echo only makes sense as the *tail* of a chained shell command that actually does cleanup work — never on its own line.

## 11. Install Transparency (when you can't do it yourself)

Some prerequisites are beyond your reach: they need admin/elevated rights (an admin PowerShell, `sudo` with a password), a GUI installer, a license acceptance, or a terminal restart to take effect. When a step hits one:

1. **Say exactly what is missing and why the task needs it** (one sentence).
2. **Give the exact command or download link** the user should run, and note the privilege level (e.g. *"run this in an **admin** PowerShell"*).
3. **Tell them how to verify** it worked (e.g. `qemu-system-arm --version` prints a version) and that a **new terminal** may be needed for PATH changes.
4. Offer to continue once it's done — via buttons (Rule 5). Do NOT silently work around the gap, retry in a loop, or pretend a degraded path is equivalent.
