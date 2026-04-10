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
- **NO markdown tables in chat messages.** Tables do not render correctly in the embedded chat UI. Use structured bullet points or numbered lists instead.
- **No tables in Task Completed summaries.** Use clear sections with bullet points.
- **Code blocks** are fine and encouraged for commands, config, and log excerpts.
- **Bold key terms** to make summaries scannable.

## 7. Tool Usage Priority (Embedded Development)
- **Prefer reading tools over shell commands:** For file inspection, use `read_file`, `search_files`, `list_files` instead of running `cat`, `grep`, or `ls` in a terminal.
- **Prefer platform tools for device commands:** Use platform-specific device tools (e.g., `nrf_device_tool`) instead of `execute_command` for any SDK-related task.
- Reserve `execute_command` (standard terminal) only for operations that genuinely require it: `git`, `pip`, `apt`, general host OS tasks.

## 8. Skill Discovery Protocol (Architecture & Optimization)
Advanced workflows and actions are documented as `.md` files in the `iot-knowledge` directory (indexed in `PLATFORM.md`). 

- **Entry-Point Hierarchy (Workflows vs Actions):** Always start a task by loading a Primary Workflow. "Actions" are internal subroutines and must NEVER be loaded as the first step of a task. You may only load an Action if an active Workflow explicitly instructs you to do so.
- **Mandatory First Load:** You **MUST** proactively use `read_file` or `view_file` to load the required skill manual from the disk before executing. Do not attempt to execute complex tasks (like analyzing logs, generating code, building and flashing etc.) based on your pre-trained knowledge or general assumptions.
- **Context Optimization (Load Once):** If you have *already loaded* a specific skill file during the current ongoing task (for example, you are repeating an iteration in a debug loop), **DO NOT load it again**. Rely on the instructions already present in your conversational history to save context limits. Only load a file if it is missing from your immediate context.
