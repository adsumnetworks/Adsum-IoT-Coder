# Next Action Plan: AIDebug-Agent Phase 2
## Agent System Tests (5 Critical Scenarios)

**Status:** Ready for Testing  
**Date:** 2026-02-09  
**Duration:** Estimated 30-45 minutes

---

## ✅ Phase 1 Complete: Infrastructure & Documentation

**What was done:**
- ✅ Created NORDIC_INSTRUCTION_HANDBOOK.md (single source of truth)
- ✅ Updated trigger_nordic_action.ts with mandatory rules
- ✅ Updated variant templates (next-gen, xs) with consistent rules
- ✅ Added platform guidance (Windows/Linux/macOS)
- ✅ Added board guidance (nRF5x variants)
- ✅ Auto-tests: 12/12 passing ✅
- ✅ Script integration tests: 5/5 passing with real device ✅
- ✅ Pre-capture-delay validated with real hardware ✅
- ✅ nrfutil reset functional ✅
- ✅ Boot sequence completely captured ✅

**Current State:** All infrastructure working perfectly, agent instructions unified and mandatory

---

## 🚀 Phase 2: Agent System Tests (NEXT)

### STEP 1: Build & Launch (5 min)

```powershell
# Verify compilation
npm run compile

# If successful → Launch debug extension
# Press F5 in VS Code
```

**Expected result:** 
- ✅ Clean compilation (0 TypeScript errors)
- ✅ Debug extension starts
- ✅ Extension loads, ready for tests

### STEP 2: Open Nordic Project (2 min)

- File → Open Folder
- Choose any Nordic project with prj.conf
- Example: `assets/example-project/` or user's own Nordic project

**Expected result:**
- ✅ Nordic backend loads
- ✅ Project type detected ("Nordic nRF Debugger")

### STEP 3: Run 5 Agent System Tests (25-30 min)

Each test validates one RULE. For each test:
1. Enter user prompt
2. Watch agent behavior
3. Verify RULE compliance
4. Check for failures

---

## Test 1: Transport Detection (RULE 1) ⭐

**User Prompt:**
```
"Show me device logs"
```

**What Agent MUST Do:**
1. ✅ Read/check prj.conf (shows in thinking)
2. ✅ Detect transport: RTT or UART
3. ✅ Report: "Detected transport from prj.conf: RTT" or "...UART"
4. ✅ Use correct transport in tool invocation

**Expected Output Format:**
```
[Nordic] Checking prj.conf...
[Nordic] Found CONFIG_LOG_BACKEND_UART=y
[Nordic] Transport selected: uart
[...capture proceeds with correct logger...]
```

**FAILURE SYMPTOMS (Agent NOT following RULE 1):**
- ❌ Agent doesn't mention prj.conf check
- ❌ Agent assumes transport without confirming
- ❌ Agent uses RTT logger for UART-only config
- ❌ Empty logs (wrong logger selected)

**Pass/Fail:** ___________

---

## Test 2: Fresh Log Capture (RULE 2) ⭐

**Setup:** Delete logs/ folder first to make sure agent captures fresh
```powershell
rm -r assets\scripts\logs\* -Force
```

**User Prompt:**
```
"Capture logs from my device"
```

**What Agent MUST Do:**
1. ✅ Capture FRESH logs (NOT read old files)
2. ✅ Show: "Starting capture for X seconds..."
3. ✅ Show: "Captured X lines from device"
4. ✅ NOT read logs/device_*.log files

**Expected Output Format:**
```
[Nordic] Starting capture for 30 seconds...
[Nordic] Capture complete: 42 lines captured
[Logs saved to: logs/device_20260209_123456.log]
```

**FAILURE SYMPTOMS (Agent NOT following RULE 2):**
- ❌ Agent reads old logs/device_*.log instead of capturing
- ❌ Agent shows stale boot sequence from yesterday
- ❌ User says: "That's not current data!"
- ❌ No "Capture started" message

**Pass/Fail:** ___________

---

## Test 3: Device Reset Graceful (RULE 3) ⭐

**User Prompt:**
```
"Reset device and capture boot sequence"
```

**What Agent MUST Do:**
1. ✅ Use trigger_nordic_action (NOT raw nrfjprog/nrfutil)
2. ✅ Script auto-detects best reset method (nrfutil/nrfjprog/warn)
3. ✅ Shows result: "Reset applied" or "WARNING: reset may have failed"
4. ✅ Capture continues regardless (graceful)

**Expected Output Format:**
```
[Nordic] Resetting device...
[RESET] Device 683007782 reset successfully (via nrfutil)
[Nordic] Starting capture for 15 seconds...
[...]Booting nRF Connect SDK...
[Captured boot sequence: 18 lines]
```

**FAILURE SYMPTOMS (Agent NOT following RULE 3):**
- ❌ Agent runs: `nrfjprog --reset -s 683007782` (direct command!)
- ❌ Tool not found → agent stops with error
- ❌ No attempt to use trigger_nordic_action
- ❌ Agent doesn't handle reset failure gracefully

**Pass/Fail:** ___________

---

## Test 4: Duration Defaults (RULE 4) ⭐

**Test 4a: Quick Test**
```
User: "Is device connected? Just a quick check."
Expected: duration="5" (NOT 30 or 60)
```

**Test 4b: Boot Capture**
```
User: "Show me the boot sequence"
Expected: duration="15" (captures complete startup)
```

**Test 4c: Extended Investigation**
```
User: "Long-term monitoring - let me know what's happening over time"
Expected: duration="60" or more (extended session)
```

**What Agent MUST Do:**
1. ✅ Infer investigation goal from user question
2. ✅ Select appropriate duration:
   - Quick question → 5 seconds
   - Boot logs → 15 seconds
   - Standard debugging → 30 seconds
   - Extended analysis → 60+ seconds
3. ✅ NOT default to 60+ seconds for quick tests

**Expected Output Format:**
```
[Quick test detected]
[Nordic] Starting 5-second capture...
[Complete in: 5 seconds]
```

**FAILURE SYMPTOMS (Agent NOT following RULE 4):**
- ❌ Quick test uses 60 seconds (user waits unnecessarily)
- ❌ Extended analysis uses 5 seconds (misses data)
- ❌ Default to middle ground (45s) always
- ❌ Ignoring user context

**Pass/Fail (4a):** _________  
**Pass/Fail (4b):** _________  
**Pass/Fail (4c):** _________

---

## Test 5: Pre-Capture Delay (RULE 5) ⭐

**User Prompt:**
```
"Capture complete boot logs from the first microsecond"
```

**What Agent MUST Do:**
1. ✅ Recognize "boot logs" → auto-apply pre-capture-delay
2. ✅ Use pre-capture-delay="2" or pre-capture-delay="3"
3. ✅ Listeners start BEFORE device reset
4. ✅ Shows: "Pre-capture-delay enabled: 2s"
5. ✅ Result: "*** Booting nRF..." appears in logs from first line

**Expected Output Format:**
```
[Nordic] Boot logs detected - using pre-capture delay
[PRE-CAPTURE] Pre-capture delay enabled: 2s
[PHASE 1] Starting log capture FIRST...
[PHASE 2] Waiting 2s for ports to stabilize...
[RESET] Device reset via nrfutil
[PHASE 3] Recording for 15 seconds...
[Complete]
*** Booting nRF Connect SDK v3.2.1...
```

**FAILURE SYMPTOMS (Agent NOT following RULE 5):**
- ❌ No pre-capture-delay applied
- ❌ Boot logs incomplete (missing first lines)
- ❌ "Booting..." line appears in middle of log (not first line)
- ❌ Agent shows: "*** Using Zephyr..." (second line, not first)

**Pass/Fail:** ___________

---

## 📊 Test Results Template

Copy and fill out:

```
TEST RESULTS - AIDebug-Agent System Tests
==========================================

Date: 2026-02-09
Tester: [Your name]
Device: [COM5 / /dev/ttyACM0 / other]
LLM Model: [Claude 4 / GPT-5 / Gemini 3 / other]

TEST 1 - Transport Detection (RULE 1):
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 2 - Fresh Log Capture (RULE 2):
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 3 - Device Reset Graceful (RULE 3):
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 4a - Quick Test Duration:
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 4b - Boot Capture Duration:
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 4c - Extended Duration:
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

TEST 5 - Pre-Capture Delay (RULE 5):
  ✅ PASS / ❌ FAIL
  Notes: ___________________________________________

SUMMARY:
  Passed: ___/8 tests
  Failed: ___/8 tests
  Critical Issues: ___________________________________________
```

---

## If Tests FAIL

### Debug Steps (in order):

1. **Check system prompt loaded**
   - Open Debug Console → Type command
   - Verify NORDIC_INSTRUCTION_HANDBOOK reference appears

2. **Check variant is active**
   - What LLM are you using? (Claude, GPT-5, Gemini, etc.)
   - Which variant gets loaded?
   - Is it using next-gen or generic?

3. **Check tool spec visible**
   - Tell agent: "What are the 5 Nordic rules?"
   - Agent should recite RULE 1-5 from handbook

4. **Check agent thinking**
   - Enable debug logging
   - Look at agent's internal reasoning
   - Is agent reading prj.conf? Is it checking rule?

5. **Check handler execution**
   - Run manual test: `trigger_nordic_action action="log_device" operation="list"`
   - Does handler work independently?
   - Is the issue in prompt or handler?

### If Specific Rule Fails

**RULE 1 (Transport) fails:**
- Agent not reading prj.conf?
- Add to prompt: "First, check prj.conf: grep CONFIG_USE_SEGGER_RTT prj.conf"
- Verify handler auto-detection works

**RULE 2 (Fresh logs) fails:**
- Agent still reading old files?
- Update handbook example: "Read prj.conf FIRST, only then read device..."
- Make distinction more explicit

**RULE 3 (Reset) fails:**
- Agent using `nrfjprog --reset` directly?
- Add warning: "This will fail if tool not installed"
- Show alternative: "Let script handle it via trigger_nordic_action"

**RULE 4 (Duration) fails:**
- Agent always using same duration?
- Add more examples to prompt with duration reasoning
- Make context-to-duration mapping more obvious

**RULE 5 (Pre-capture) fails:**
- Agent forgetting pre-capture-delay?
- Add checklist: "Boot logs? → Yes → pre-capture-delay="3""
- Show boot log example in prompt

---

## Success Criteria

**All 5 Tests PASS:** 
- ✅ Agent follows instructions reliably
- ✅ Handbook effective
- ✅ Ready for production use
- ✅ Move to real-world testing

**4/5 Tests PASS:**
- ⏳ One rule needs refinement
- ⏳ Update that specific rule in handbook
- ⏳ Re-test that scenario

**Fewer than 4/5 PASS:**
- 🔴 Significant prompt issues
- 🔴 Review variant assignments
- 🔴 Check if handbook was loaded
- 🔴 Consider LLM-specific overrides needed

---

## Quick Reference: 5 Rules Summary

| Rule | IF User Says | THEN Agent MUST | Violation = |
|------|-------------|-----------------|-----------|
| **1** | "Show logs" | Read prj.conf FIRST | Wrong logger, empty logs |
| **2** | "Show logs" | Capture FRESH (not old) | Stale data shown |
| **3** | "Reset device" | Use trigger_nordic_action | Tool crashes |
| **4** | "Quick check" | Use 5s (not 60s) | User wait time |
| **5** | "Boot logs" | Pre-capture-delay="3" | Missing first lines |

---

## Before You Start Testing

Checklist:
- [ ] Device connected and visible
- [ ] Nordic project has prj.conf
- [ ] Compilation successful (0 errors)
- [ ] VS Code extension launches (F5)
- [ ] Real device on Windows or Linux (try both if possible)

**Recommended Test Order:**
1. TEST 2 (Fresh Logs) - easiest to verify
2. TEST 1 (Transport) - depends on prj.conf
3. TEST 3 (Reset) - requires real device interaction
4. TEST 4 (Duration) - multiple variations
5. TEST 5 (Pre-Capture) - most advanced

---

**Estimated Total Time:** 30-45 minutes  
**Report Results:** Come back with pass/fail for each test

---

**Ready?** Launch VS Code, press F5, and start TEST 1!
