# Agent System Tests: Quick Start with Prompts

**Status:** ✅ Ready to run  
**Auto-tests:** ✅ 12/12 passing  
**Compilation:** ✅ 0 TypeScript errors  
**Duration:** 30-45 minutes

---

## 🚀 How to Start

### Step 1: Launch Extension (5 min)
```powershell
# In VS Code, press F5
# Wait for debug extension to load
# Should see: "Nordic nRF Debugger" in sidebar
```

### Step 2: Open Nordic Project (2 min)
```
File → Open Folder
Choose any Nordic project with prj.conf
(or create test project)
```

### Step 3: Run 5 Tests (25-30 min)

Each test has a **PROMPT** to copy/paste into the extension chat.

---

## 📋 TEST 1: Transport Detection (RULE 1)
**What it tests:** Agent reads prj.conf and auto-detects RTT vs UART

### The Prompt to Use:
```
Show me device logs and tell me what transport type you detected from the project configuration.
```

### What Agent MUST Do:
- ✅ Shows thinking about reading prj.conf
- ✅ Reports: "RTT enabled" or "UART enabled"
- ✅ Starts capture with correct transport
- ✅ Does NOT assume transport

### Success: ✅ or Failure: ❌
```
✅ PASS if: Agent mentions prj.conf + reports transport decision
❌ FAIL if: Silent about transport, doesn't check config, guesses wrong
```

---

## 📋 TEST 2: Fresh Logs (RULE 2)
**What it tests:** Agent captures NEW logs, not old log files

### Setup (Important!):
```powershell
# Delete old logs first
rm -r assets\scripts\logs\* -Force
rm -r assets\scripts\rtt_logs\* -Force
```

### The Prompt to Use:
```
Capture fresh logs from my device for 10 seconds. I want to see what's happening right now, not logs from before.
```

### What Agent MUST Do:
- ✅ Shows "Starting capture..."
- ✅ Waits 10 seconds
- ✅ Shows "Captured X lines"
- ✅ Does NOT say "Reading old logs"

### Success: ✅ or Failure: ❌
```
✅ PASS if: Agent captures fresh, shows live data
❌ FAIL if: Agent reads logs/ folder, shows old timestamps, mentions "found existing logs"
```

---

## 📋 TEST 3: Device Reset Graceful (RULE 3)
**What it tests:** Agent uses script for reset (not direct commands)

### The Prompt to Use:
```
Reset my device and then capture boot logs for 15 seconds. I want to see the boot sequence.
```

### What Agent MUST Do:
- ✅ Uses trigger_nordic_action (handler invoked)
- ✅ Shows reset success: "Device reset via nrfutil" or "Reset applied"
- ✅ Even if no device: doesn't crash with error
- ✅ Continues with capture gracefully

### Success: ✅ or Failure: ❌
```
✅ PASS if: Agent shows reset attempt, capture proceeds
❌ FAIL if: Agent tries "nrfjprog --reset" directly, shows tool-not-found error, gives up
```

---

## 📋 TEST 4a: Quick Test Duration (RULE 4)
**What it tests:** Agent uses SHORT duration for quick questions

### The Prompt to Use:
```
Quick question - is my device connected and responding?
```

### What Agent MUST Do:
- ✅ Duration: 5 seconds (NOT 30, NOT 60)
- ✅ Fast response: "Device is connected" or "No response"
- ✅ Doesn't make user wait

### Success: ✅ or Failure: ❌
```
✅ PASS if: Capture lasts ~5 seconds total
❌ FAIL if: Waits 30+ seconds for quick test
```

---

## 📋 TEST 4b: Boot Capture Duration (RULE 4)
**What it tests:** Agent uses MEDIUM duration for boot logs

### The Prompt to Use:
```
Show me the boot sequence. I want to see from the first startup message.
```

### What Agent MUST Do:
- ✅ Duration: 15 seconds (covers complete boot)
- ✅ Shows startup messages
- ✅ Doesn't use 5s (too short) or 60s (too long)

### Success: ✅ or Failure: ❌
```
✅ PASS if: ~15 second capture shows complete boot
❌ FAIL if: 5 seconds (incomplete), 60 seconds (overkill), 30 seconds (wrong)
```

---

## 📋 TEST 4c: Extended Duration (RULE 4)
**What it tests:** Agent uses LONG duration for extended investigation

### The Prompt to Use:
```
I need extended monitoring. Monitor my device for the next minute and show me what's happening with all the log output.
```

### What Agent MUST Do:
- ✅ Duration: 60+ seconds (extended session)
- ✅ Captures complete activity window
- ✅ Not too short for extended analysis

### Success: ✅ or Failure: ❌
```
✅ PASS if: ~60 seconds or more captured
❌ FAIL if: 5 seconds, 15 seconds, 30 seconds (too short for "extended monitoring")
```

---

## 📋 TEST 5: Pre-Capture Delay (RULE 5)
**What it tests:** Agent captures boot from FIRST MICROSECOND

### The Prompt to Use:
```
Capture the complete boot sequence from the very first startup message. Make sure I don't miss any boot logs.
```

### What Agent MUST Do:
- ✅ Uses pre-capture-delay (starts listening BEFORE reset)
- ✅ Boot sequence starts with "*** Booting nRF Connect SDK"
- ✅ First line is "Booting", not "Using Zephyr" (second line)
- ✅ Shows in output: "Pre-capture delay enabled" or similar

### Success: ✅ or Failure: ❌
```
✅ PASS if: First line in logs is "*** Booting nRF Connect SDK ***"
❌ FAIL if: First line is "*** Using Zephyr..." (missed boot), no pre-capture-delay shown
```

---

## 📊 Results Checklist

Copy this and fill in after each test:

```
TEST RESULTS
============

TEST 1 - Transport Detection (RULE 1):  ✅ PASS  or  ❌ FAIL
  Agent checked prj.conf? YES / NO
  Reported transport? YES / NO

TEST 2 - Fresh Logs (RULE 2):  ✅ PASS  or  ❌ FAIL
  Captured fresh? YES / NO (not old logs)
  Showed capture progress? YES / NO

TEST 3 - Device Reset (RULE 3):  ✅ PASS  or  ❌ FAIL
  Used trigger_nordic_action? YES / NO
  Showed reset result? YES / NO

TEST 4a - Quick Duration:  ✅ PASS  or  ❌ FAIL
  Duration ~5 seconds? YES / NO

TEST 4b - Boot Duration:  ✅ PASS  or  ❌ FAIL
  Duration ~15 seconds? YES / NO

TEST 4c - Extended Duration:  ✅ PASS  or  ❌ FAIL
  Duration 60+ seconds? YES / NO

TEST 5 - Pre-Capture Delay (RULE 5):  ✅ PASS  or  ❌ FAIL
  First line shows "*** Booting"? YES / NO
  Pre-capture-delay mentioned? YES / NO

SUMMARY:
  Tests Passed: ___/7
  Tests Failed: ___/7
  Critical Issues: ________________
```

---

## 🎯 Expected Results

**If ALL TESTS PASS:** ✅✅✅
- Agent follows all 5 rules reliably
- System prompt unification working
- Ready for production use
- Move to extended testing

**If 6/7 PASS:** ⏳
- One rule needs refinement
- Identify which test failed
- Update that specific rule
- Re-test

**If Fewer PASS:** 🔴
- Multiple rule issues
- Check if handbook was loaded
- Verify correct LLM variant active
- See NEXT_ACTION_PLAN_AGENT_TESTS.md for debug steps

---

## 🚀 GO!

Ready? 

1. **Press F5** (launch extension)
2. **Open Nordic project** (File → Open Folder)
3. **Copy first prompt** (TEST 1 - Transport Detection)
4. **Paste into chat** and watch agent
5. **Record result** (PASS/FAIL)
6. **Move to TEST 2**, repeat

**Time:** 30-45 minutes for all 5 tests

**Good luck!** 🎯
