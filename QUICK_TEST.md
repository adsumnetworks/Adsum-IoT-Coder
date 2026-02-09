# Nordic Agent - Single Comprehensive Test

**Time:** 5-10 minutes | **Complexity:** Tests all 5 RULES at once

---

## 🎯 The One Prompt (Copy & Paste This)

```
I just flashed new firmware to my nRF device. Show me the complete boot sequence 
from the very first startup message. Use device reset to trigger the boot, and 
capture all logs. I need to verify the device is working correctly.
```

---

## ✅ What This Tests

| RULE | What Agent Should Do | Status |
|------|---------------------|--------|
| **RULE 1** | Read prj.conf to detect RTT or UART transport | ☐ PASS ☐ FAIL |
| **RULE 2** | Capture FRESH logs (not analyze old logs folder) | ☐ PASS ☐ FAIL |
| **RULE 3** | Use `trigger_nordic_action` to reset (graceful) | ☐ PASS ☐ FAIL |
| **RULE 4** | Use ~15 seconds (boot capture duration) | ☐ PASS ☐ FAIL |
| **RULE 5** | Use pre-capture-delay to catch first line "Booting" | ☐ PASS ☐ FAIL |

---

## 🔍 Quick Checklist (After Running Prompt)

### Phase 1: Diagnostics (Agent should ask or verify)
- [ ] Agent asks "Is device connected?" or similar verification
- [ ] Agent shows "Checking prj.conf for transport..."
- [ ] Agent reports transport: "RTT detected" or "UART detected"

### Phase 2: Execution (What happens)
- [ ] Agent shows "Device reset..." or "Triggering reset..."
- [ ] Agent shows "Capturing X seconds for boot sequence..."
- [ ] No mention of reading `logs/` folder (old files)
- [ ] Shows pre-capture delay message (if used)

### Phase 3: Results (What you see)
- [ ] First line of logs contains "*** Booting nRF Connect SDK"
- [ ] Boot sequence complete (15+ lines, not just 3-5)
- [ ] Timestamps are current (just captured, not old)
- [ ] Shows device initialization messages
- [ ] Shows "Capture complete" or similar

---

## 🎯 Your Decision (Mark One)

```
RESULT:
☐ ✅ ALL 5 RULES WORKING - Agent ready for production
☐ ⚠️  4/5 RULES WORKING - One rule needs refinement (which one?)
☐ ❌ <4/5 RULES WORKING - Multiple issues (list below)

Which rule(s) failed (if any):
_________________________________________

Agent behavior that was wrong:
_________________________________________

Device was connected? YES / NO
Transport detected correctly? RTT / UART / Not reported
```

---

## 🚀 How to Run

1. **Copy the prompt** above (blue box)
2. **Paste into AI Debug Agent chat**
3. **Watch the agent work** (takes 20-30 seconds)
4. **Check against the checklist** above
5. **Mark PASS or FAIL** for each RULE
6. **Report result** to user

---

## Example Output (If All Works ✅)

```
Agent says:
"Let me check your setup first... 
 - Device connected? I'll verify.
 - Checking prj.conf for transport type...
 - Found UART backend enabled
 
 Starting device reset and boot capture...
 Pre-capture delay: 3 seconds (starting listeners)
 Resetting device...
 Capturing 15 seconds for boot sequence...
 
 ✓ Capture complete!
 
 Boot sequence:
 *** Booting nRF Connect SDK v3.2.1
 *** Using Zephyr v4.2.99
 [00:00:00.123] Starting application initialization
 [00:00:00.245] Device UUID: XXXXXXXX
 ..."
```

---

## Example Checklist (If All Works ✅)

```
RESULT: ✅ ALL 5 RULES WORKING

RULE 1 (Transport): ✅ PASS - Agent checked prj.conf, found UART
RULE 2 (Fresh Logs): ✅ PASS - Captured fresh, no old files mentioned
RULE 3 (Reset): ✅ PASS - Used trigger_nordic_action, no direct nrfjprog
RULE 4 (Duration): ✅ PASS - Used 15 seconds (boot capture)
RULE 5 (Pre-Capture): ✅ PASS - Used pre-capture-delay, first line shows "Booting"
```

---

## ⏱️ Timing

- Agent checks device: 1-2 sec
- Pre-capture delay: 3 sec
- Device reset: 1 sec
- Capture: 15 sec
- **Total: ~25 seconds**

---

**Done!** One prompt. All 5 rules. Quick decision. 🎯
