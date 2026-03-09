# Nordic Development Instruction Handbook
## Single Source of Truth for AI Agent Behavior

**Version:** 2.0  
**Last Updated:** 2026-02-09  
**Status:** MANDATORY - All variants MUST follow these rules

---

## 🚨 CRITICAL: 5 MANDATORY AGENT RULES

These rules are **NON-NEGOTIABLE** and apply to **ALL LLM VARIANTS, ALL PLATFORMS, ALL BOARDS**.

### RULE 1: TRANSPORT SELECTION - Auto-Detect FIRST ⭐⭐⭐

**MANDATORY INSTRUCTION:**
1. **ALWAYS read prj.conf first** (before any tool invocation)
   ```bash
   grep -i "CONFIG_USE_SEGGER_RTT\|CONFIG_LOG_BACKEND_UART" prj.conf
   ```

2. **Transport detection logic** (in order):
   - RTT Indicators → use transport="rtt":
     - `CONFIG_USE_SEGGER_RTT=y` OR `CONFIG_LOG_BACKEND_RTT=y` → **DEFINITELY RTT**
   - UART Indicators → use transport="uart":
     - `CONFIG_LOG_BACKEND_UART=y` OR `CONFIG_UART_CONSOLE=y` → **DEFINITELY UART**
   - Port format clues:
     - `COM3`, `COM5`, `/dev/ttyACM0` (serial ports) → UART
     - `683007782` (9-digit number, J-Link serial) → RTT

3. **NEVER assume RTT unless prj.conf confirms**
   - Default assumption: UART (most common for first-time users)
   - Only switch to RTT if you see `CONFIG_USE_SEGGER_RTT=y`

4. **ALWAYS use handler auto-detection**
   - Never hardcode transport
   - Tool handler reads prj.conf and auto-detects

**FAILURE SYMPTOM:** Agent uses UART logger for RTT-only project (or vice versa) → logs appear empty

---

### RULE 2: LOG CAPTURE vs FILE ANALYSIS - FRESH by Default ⭐⭐⭐

**MANDATORY INSTRUCTION:**

**When user says:**
- "Show me device logs" → **ALWAYS capture FRESH from device** (next 10-30 seconds)
- "Capture logs" → **ALWAYS capture FRESH from device**
- "What's wrong?" → **ALWAYS capture FRESH from device**

**When user explicitly says:**
- "Analyze this log file" → THEN read old files from `logs/` folder
- "Check the logs/device_*.log" → THEN analyze old files
- "Compare boot logs" → THEN read old files

**CRITICAL MISTAKE TO AVOID:**
```
User: "Show me device logs"
BAD:   Agent reads logs/device_20260209_061642.log ❌ OLD LOG
GOOD: Agent captures fresh logs with trigger_nordic_action ✅ LIVE DATA
```

**NEVER analyze old logs without confirming first**
```typescript
// WRONG - analyzing old logs without user confirmation
const oldLogs = readFileSync("logs/device_*.log")
analyzeOldLogs(oldLogs)  // ❌ WRONG

// RIGHT - ask user first
if (userWantsAnalysis) {
  const oldLogs = readFileSync("logs/device_*.log")
  analyzeOldLogs(oldLogs)  // ✅ CORRECT
}
```

**FAILURE SYMPTOM:** Agent shows old logs → user says "That's from yesterday!" → agent looks confused

---

### RULE 3: DEVICE RESET - Let Script Handle Gracefully ⭐⭐⭐

**MANDATORY INSTRUCTION:**

**NEVER call nrfjprog or nrfutil DIRECTLY**
- ❌ DON'T: `nrfjprog --reset -s 683007782`
- ❌ DON'T: `nrfutil device reset --serial-number 683007782`
- ✅ DO: Use `trigger_nordic_action action="log_device"` (script handles reset)

**Reset strategy (built into nrf_logger.py):**
1. Try nrfutil (modern, primary) → `nrfutil device reset --serial-number <SN>`
2. If nrfutil missing → Try nrfjprog (legacy, fallback) → `nrfjprog --reset -s <SN>`
3. If both missing → WARN (not ERROR) and continue capturing anyway

**Script behavior on reset failure:**
- Capture CONTINUES even if reset fails
- User sees warning, not error
- This is INTENTIONAL (graceful degradation)

**FAILURE SYMPTOM:** Agent tries to use nrfjprog → tool not found → agent stops (wrong!)

---

### RULE 4: CAPTURE DURATION - Match Investigation Goal ⭐⭐⭐

**MANDATORY INSTRUCTION:**

**Context-appropriate durations:**
- **5 seconds** (quick test): "Is device connected?" → verify basic responsiveness
- **15 seconds** (boot capture): "Show me boot sequence" → capture complete startup
- **30 seconds** (standard): "Capture logs while I test" → normal debugging session
- **60+ seconds** (extended): "Long-running issue" → extended investigation

**NEVER default to 45+ seconds for quick tests**
- Quick question ("Is device connected?") → use 5 seconds
- Standard investigation → use 30 seconds
- Extended troubleshooting → use 60+ seconds

**FAILURE SYMPTOM:** Agent uses 60s for quick test → user waits 1 minute unnecessarily

---

### RULE 5: PRE-CAPTURE DELAY - Keep Complete Boot Sequence ⭐⭐⭐

**MANDATORY INSTRUCTION:**

**When to use pre-capture-delay:**
- Capturing boot logs (to get "Booting nRF..." from first microsecond)
- Device needs stabilization time after reset
- Listeners must start BEFORE device resets

**How it works:**
1. Start listeners (2-3 seconds early)
2. Listeners wait for data to arrive
3. THEN reset device
4. Device boots → listeners capture from first line

**Implementation:**
```typescript
trigger_nordic_action 
  action="log_device" 
  operation="capture" 
  port="COM5"
  duration="15"
  pre-capture-delay="3"  // Start listening 3 seconds early
  reset="true"           // Then reset device
```

**Result:** Complete boot sequence including "*** Booting nRF Connect SDK ***" from first microsecond

**FAILURE SYMPTOM:** Boot logs appear incomplete → missing "Booting..." line → pre-capture-delay needed

---

## 🖥️ PLATFORM-SPECIFIC GUIDANCE

### Windows (PRIMARY PLATFORM FOR THIS PROJECT)

**UART Port Format:**
- `COM3`, `COM5`, `COM12` (NOT `/dev/ttyACM0`)
- Double-check with Device Manager → Ports (COM & LPT)

**List connected devices:**
```powershell
nrfutil device list
```

**Example capture (Windows):**
```typescript
trigger_nordic_action
  action="log_device"
  operation="capture"
  port="COM5"           // Windows format
  duration="30"
  output="logs/"
```

**Common issue:** `/dev/ttyACM0` on Windows → Use `COM5` instead

---

### Linux (SECONDARY PLATFORM)

**UART Port Format:**
- `/dev/ttyACM0`, `/dev/ttyACM1` (Linux format)

**Required permissions:**
```bash
ls -la /dev/ttyACM0  # Should show rw permissions
```

**Example capture (Linux):**
```typescript
trigger_nordic_action
  action="log_device"
  operation="capture"
  port="/dev/ttyACM0"   // Linux format
  duration="30"
  output="logs/"
```

**Common issue:** Permission denied → Add user to `dialout` group

---

### macOS (TERTIARY PLATFORM)

**UART Port Format:**
- `/dev/tty.usbserial-*` or `/dev/cu.usbserial-*`

**List ports:**
```bash
ls -la /dev/tty.usbserial-* 2>/dev/null || ls -la /dev/cu.usbserial-*
```

---

## 🎛️ BOARD-SPECIFIC GUIDANCE

### nRF52840 DK (PCA10056)

**Serial format:** 9-digit number (e.g., `683007782`)
**Typical config:**
```kconfig
CONFIG_BOARD=nrf52840dk_nrf52840
CONFIG_LOG_BACKEND_UART=y  # or RTT
CONFIG_UART_CONSOLE=y
```
**Transport:** UART (by default) or RTT (if `CONFIG_USE_SEGGER_RTT=y`)
**Expected port:** `COM5` (Windows) or `/dev/ttyACM0` (Linux)

### nRF5340 DK (PCA10095)

**Serial format:** 9-digit number
**Typical config:**
```kconfig
CONFIG_BOARD=nrf5340dk_nrf5340_cpuapp
CONFIG_LOG_BACKEND_UART=y
```
**Transport:** UART (primary) or RTT (if enabled)
**Expected port:** `COM3`-`COM5` (Windows, one for app, one for net core)

### nRF54H20 DK

**Serial format:** 9-digit number
**Very new board** (NCS 3.1+)
**Typical config:**
```kconfig
CONFIG_BOARD=nrf54h20dk_nrf54h20
CONFIG_LOG_BACKEND_UART=y
```

### nRF Connect Key (Portable)

**No J-Link onboard** → must use external debugger or USB UART adapter
**Serial format:** Check with `nrfutil device list`

---

## 🔧 NCS VERSION GUIDANCE

### nRF Connect SDK v3.2.1 (CURRENT STABLE)

**recommended transport:** UART (simpler, more reliable)
**nrfutil command:** `nrfutil device reset --serial-number <SN>`
**Boot message:** `*** Booting nRF Connect SDK v3.2.1-...`

### nRF Connect SDK v3.1.0 (LEGACY)

**recommended transport:** UART or RTT
**nrfutil command:** Same as v3.2.1

### nRF Connect SDK v3.3.0 (FUTURE - NOT YET STABILIZED)

**Monitor compatibility issues**

---

## 📚 MANDATORY TOOL INVOCATION PATTERNS

### Pattern 1: Quick Device Check
```typescript
// "Is device connected?" → 5 second test
trigger_nordic_action
  action="log_device"
  operation="capture"
  port="COM5"       // or /dev/ttyACM0 on Linux
  duration="5"
  reset="false"     // Don't reset, just check current data
```

### Pattern 2: Boot Sequence Capture
```typescript
// "Show me boot logs" → 15 seconds with pre-capture delay
trigger_nordic_action
  action="log_device"
  operation="capture"
  port="COM5"
  duration="15"
  pre-capture-delay="3"  // Start listening BEFORE reset
  reset="true"           // Then reset device
```

### Pattern 3: Standard Debugging Session
```typescript
// "Capture logs while I test" → 30 second standard capture
trigger_nordic_action
  action="log_device"
  operation="capture"
  port="COM5"
  duration="30"      // Standard default
  output="logs/"
```

### Pattern 4: Multi-Device Capture
```typescript
// "Capture from central and peripheral" → both devices simultaneously
trigger_nordic_action
  action="log_device"
  operation="capture"
  devices="central:COM5,peripheral:COM6"  // or serial numbers for RTT
  duration="30"
  reset="true"
  output="logs/"
```

### Pattern 5: RTT Capture (if configured)
```typescript
// "Capture RTT logs" → use serial numbers for RTT
trigger_nordic_action
  action="log_device"
  operation="capture"
  transport="rtt"
  port="683007782"   // J-Link serial number (NOT COM port)
  duration="30"
  reset="true"
```

---

## 🔶 INSTRUCTION-FOLLOWING REQUIREMENTS

### For GENERIC Variant (Fallback)
- Include RULES 1-5 VERBATIM
- Include platform guidance (Windows primary)
- Include board guidance (common boards)
- Include 5 mandatory patterns above
- **Length:** Full handbook (complete reference)

### For NEXT-GEN Variant (Advanced models: Claude 4, GPT-5+)
- Include RULES 1-5 with condensed reference
- Include advanced patterns (multi-device, edge cases)
- Include troubleshooting section
- **Length:** 70% of full handbook (advanced optimized)

### For XS Variant (Small models, local LLMs)
- Include RULES 1-3 only (simplified)
- **DO NOT** suggest advanced features
- **DO** include clear mandatory patterns
- **Length:** 30% of full handbook (ultra-concise)

### For Native Tool Variants (GPT-5.1, Gemini 3)
- Include RULES 1-5 with native tool emphasis
- Adjust examples to use native tool calling syntax
- **Length:** 60% of full handbook (concise optimized)

---

## ❌ CRITICAL MISTAKES TO AVOID

| Mistake | Consequence | Fix |
|---------|-----------|-----|
| Read old logs without user confirmation | User sees stale data | ALWAYS ask "Do you want me to capture fresh logs?" |
| Use nrfjprog directly | Tool may not be installed | Use `trigger_nordic_action` (script handles gracefully) |
| Assume RTT without checking prj.conf | Wrong logger, empty logs | ALWAYS read prj.conf first (RULE 1) |
| Use COM or /dev/tty ports for RTT | J-Link fails to connect | ALWAYS use the 9-12 digit J-Link Serial Number for RTT (e.g. 683007782) |
| Use `/dev/ttyACM0` on Windows | Port doesn't exist | Use `COM5` or check Device Manager |
| Default to 60s for quick test | User waits unnecessarily | ALWAYS match duration to investigation (RULE 4) |
| Skip pre-capture-delay for boot | Missing first startup lines | ALWAYS use pre-capture-delay for "show boot" (RULE 5) |

---

## 🔄 DECISION TREE FOR AGENT (MANDATORY ALGORITHM)

When user says **"Show me logs"**:

```
1. Check if project has prj.conf
   ├─ YES: Read it → Check for CONFIG_USE_SEGGER_RTT or CONFIG_LOG_BACKEND_UART
   │       ├─ RTT config found → Use transport="rtt" (RULE 1)
   │       └─ UART config found → Use transport="uart" (RULE 1)
   └─ NO: Default to transport="uart" (most common)

2. Check device availability
   ├─ Multiple devices → Use auto_detect="true"
   └─ Single device → Specify port or serial

3. Determine duration (RULE 4)
   ├─ "Is device connected?" → 5 seconds
   ├─ "Show boot sequence" → 15 seconds
   ├─ Standard logging → 30 seconds
   └─ Extended issue → 60+ seconds

4. Determine pre-capture-delay (RULE 5)
   ├─ "Show boot logs" → pre-capture-delay="3"
   └─ Other → pre-capture-delay="0" (default)

5. Execute capture
   └─ trigger_nordic_action action="log_device" operation="capture"
      [Invoke with detected parameters from steps 1-4]

6. Present results
   └─ NEVER show old logs (RULE 2)
   └─ ALWAYS show captured data from step 5
```

---

## 📋 CHECKLIST FOR VARIANT DEVELOPERS

When updating a variant to use Nordic instructions:

- [ ] Import this handbook as reference comment
- [ ] Include RULES 1-5 (verbatim or variant-specific)
- [ ] Include platform guidance (Windows primary)
- [ ] Include 5 mandatory patterns
- [ ] Include decision tree (algorithm)
- [ ] Test with real device (Windows + Linux)
- [ ] Verify agent uses trigger_nordic_action (not raw commands)
- [ ] Verify agent captures fresh logs (not old files)
- [ ] Verify pre-capture-delay used for boot logs
- [ ] Verify agent matches duration to investigation goal

---

## 📞 QUESTIONS DEVELOPERS SHOULD ASK

If uncertain about a feature:

1. **Does it violate RULES 1-5?** → DON'T implement
2. **Is it multi-platform tested?** → DON'T assume Windows-only works
3. **Is it board-tested?** → DON'T assume all nRF boards work the same
4. **Is it NCS version compatible?** → DON'T hardcode paths/commands
5. **Does agent FOLLOW instructions or SUGGEST them?** → Agent MUST FOLLOW

---

**Last reviewed:** 2026-02-09  
**Next review:** When new LLM variant added OR new NCS version released  
**Maintainer:** AIDebug Team

---

# 📊 LOG ANALYZER WORKFLOW (MANDATORY)

Follow this workflow EXACTLY when user asks to "analyze logs", "debug device", or "show logs".

## STEP 1: DETECT LOGGING BACKEND
1. **Check prj.conf FIRST:**
   - `grep -E "CONFIG_LOG_BACKEND_RTT|CONFIG_USE_SEGGER_RTT" prj.conf` → **RTT**
   - `grep -E "CONFIG_LOG_BACKEND_UART|CONFIG_UART_CONSOLE" prj.conf` → **UART**
   - `grep "CONFIG_LOG=n" prj.conf` → **LOGGING DISABLED** (Warn user)
2. **If unclear:** Run 5-10 second test on BOTH if possible, or ask user.
3. **If 2+ devices:** They might use different backends (unlikely but possible).
4. **NEVER start recording without knowing backend.**

## STEP 2: IDENTIFY DEVICES AND ROLES
1. **List all connected devices:** `trigger_nordic_action action="log_device" operation="list"`
2. **Match to open projects:**
   - **Case 1 (2 devices + 2 projects):** "I found 2 devices and 2 projects (central/peripheral). I'll record both simultaneously."
   - **Case 2 (1 device + 2 projects):** "Which project is flashed? [Project A] [Project B]"
   - **Case 3 (2 devices + 1 project):** "Are both running the same firmware? Assign roles: [Device 1: Central/Periph] [Device 2s: Central/Periph]"
3. **NEVER guess roles silently.** Always confirm if ambiguous.

## STEP 3: DETERMINE RECORDING DURATION
- **Initial Check:** 15s (default)
- **Complex Issue:** 60s
- **User Override:** Always offer `[15s] [30s] [60s] [Custom]`

## STEP 4: RECORD LOGS
- **Naming Convention:** `logs/{backend}/{role}_{SN}_{DT}.log`
- **Multi-device:** Record simultaneously.
- **Boot Logs:** Use `pre-capture-delay="3"` + `reset="true"`.
- **Command:**
  ```typescript
  trigger_nordic_action 
    action="log_device" 
    operation="capture"
    devices="central:COM5,peripheral:COM6" 
    duration="15"
    output="logs/"
  ```

## STEP 5: ANALYZE LOGS
- **Parse BLE Events:** Advertising, Scanning, Connected, Disconnected (reason), MTU, Data.
- **Create Timeline:** Correlate timestamps between devices if multiple.
- **Identify Issues:** Error codes (0x08, 0x13, etc.), Hard Faults, Resets.
- **Show Snippets:** 1-2 lines of actual log text as proof.

## STEP 6: GENERATE SUMMARY
**Format:**
1. **Device Details:** SN, Port, Project, SDK, Toolchain.
2. **Key Events:** Bullet points with timestamps.
3. **BLE Timeline:** (If applicable) Table showing A → B interactions.
4. **Analysis:** ✅ Successes, ⚠️ Warnings, ❌ Errors.
5. **Recommendations:** Specific actions (not generic).

## STEP 7: ANSWER QUESTIONS
- **CAN:** Analyze logs, explain events, suggest logging configs.
- **CANNOT:** Fix code (I am an analyst), modify app logic.
- **Redirect:** "I can't fix the code directly, but the logs show the error is X. I suggest checking Y."

---

