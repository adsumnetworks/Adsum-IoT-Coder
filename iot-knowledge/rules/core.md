# Universal Embedded Rules

These rules apply universally to any IoT or Embedded project context.

## 1. Project Analysis
- **Always Validate Build State:** Before debugging code, ensure the project builds correctly.
- **Artifact Awareness:** Check for the existence of `build/` directories and artifacts (`.hex`, `.bin`, `.elf`).

## 2. Hardware Debugging
- **Never guess communication parameters:** If a serial port or baud rate is required, check the project configuration or ask the user.
- **Logs are truth:** Rely on device logs (UART/RTT) before analyzing source code logic when debugging runtime issues.

## 3. Configuration First
- Start debugging by examining configuration overlays.
- In embedded systems, peripheral allocation (DeviceTree) and enabled features (Kconfig) usually cause more issues than raw C/C++ code.

## 4. Flash Safety
- Assume all flash operations are disruptive.
- Never flash a device without confirming the target board model and connection state.

## 5. Proactive Action via Buttons (Global UX Rule)
Any high-value recommendation MUST be presented to the user as clickable buttons using `ask_followup_question` with the `options` parameter. Do NOT present recommendations as plain text that requires the user to type a response.

**Examples of when buttons are ALWAYS required:**
- Suggesting to enable RTT logging → `options: ["Enable RTT in prj.conf", "Keep current backend"]`
- Offering to Build/Flash → `options: ["Build & Flash now", "I'll do it manually", "Ask me each time"]`
- Suggesting to capture device logs → `options: ["Capture RTT logs now", "Capture UART logs now", "Skip for now"]`
- Analyzing logs after capture → `options: ["Show log snippet here", "Give me the file path", "Analyze for errors"]`
- Offering deeper BLE stack logging → `options: ["Enable BLE stack logs", "No thanks", "Check current logs first"]`

**Rule:** After completing any significant action, summarize what was done in one sentence, then immediately present the next logical step(s) as buttons. Do NOT ask open-ended questions like "What would you like to do next?".
