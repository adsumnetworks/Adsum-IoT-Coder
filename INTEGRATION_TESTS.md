# AIDebug Nordic Agent - Integration Tests

**Version:** 1.0  
**Last Updated:** February 9, 2026  
**Status:** Ready for Phase 2 Testing  
**Duration:** 30-45 minutes (7 tests)  

---

## Overview

This document contains **7 integration test scenarios** to verify the AI agent correctly follows all 5 mandatory Nordic rules:

1. **RULE 1:** Transport auto-detection (RTT vs UART)
2. **RULE 2:** Fresh log capture vs old file analysis  
3. **RULE 3:** Device reset graceful handling
4. **RULE 4:** Appropriate capture duration selection
5. **RULE 5:** Pre-capture delay for complete boot logs

---

## Pre-Test Checklist

Before starting ANY test:

- [ ] Device is USB-connected to computer
- [ ] Device is visible in system (COM port or J-Link)
- [ ] Project has `prj.conf` file configured
- [ ] Nordic nRF Connect terminal is open in VS Code
- [ ] Launch debug extension: Press **F5**
- [ ] Open a Nordic project: File → Open Folder
- [ ] AI Debug Agent sidebar is visible

**To Launch Tests:**
```bash
# In VS Code terminal
cd c:\Projects\AIDebug-Agent
npm run compile
# Press F5
```

---

## TEST 1: Transport Detection (RULE 1)

**What it tests:** Agent reads prj.conf and auto-detects RTT vs UART transport.

### The Prompt
```
Show me device logs and tell me what transport type you detected from the project configuration.
```

### What Agent SHOULD Do
1. Read the project's `prj.conf` file
2. Search for `CONFIG_USE_SEGGER_RTT` or `CONFIG_LOG_BACKEND_UART`  
3. Clearly report the transport type: "RTT detected" or "UART detected"
4. Proceed with correct transport setting
5. Never assume - always check prj.conf first

### ✅ PASS Criteria
- Agent explicitly mentions reading/checking prj.conf
- Agent reports transport decision (RTT or UART)
- Agent uses correct transport for capture
- No guessing or attempting both transports

### ❌ FAIL Criteria  
- Agent doesn't mention prj.conf
- Agent tries random transport (UART on RTT project or vice versa)
- Agent doesn't report which transport it selected
- Logs appear empty (wrong transport chosen)

### Record Result
```
TEST 1 (Transport Detection):  ✅ PASS  or  ❌ FAIL
  Transport detected: [ RTT / UART / Not reported ]
  Checked prj.conf: [ YES / NO ]
  Device connected message: [ YES / NO / "No devices" ]
```

---

## TEST 2: Fresh Logs (RULE 2)

**What it tests:** Agent captures NEW logs from device, not old log files.

### Setup (Important!)
```powershell
# Before this test, clean up old logs
rm -r C:\Users\<YourName>\nrf-projects\<project>\logs\* -Force
```

### The Prompt
```
Capture fresh logs from my device for 10 seconds. I want to see what's happening right now, not logs from before.
```

### What Agent SHOULD Do
1. Verify device is connected
2. Start capturing FRESH logs (not reading files)
3. Show "Capturing X seconds..." message
4. Wait 10 seconds for device output
5. Display newly captured logs
6. NOT mention "reading old logs" or file paths

### ✅ PASS Criteria
- Agent shows "Capturing..." message (indicates live capture)
- Agent waits full 10 seconds
- Output contains fresh device data
- No mention of `logs/` folder or old files
- Output timestamps are recent (just captured)

### ❌ FAIL Criteria
- Agent reads `logs/device_*.log` from disk
- Agent shows timestamps from yesterday
- Agent says "Found existing logs in logs/ folder"
- Capture time is instant (no waiting)

### Record Result
```
TEST 2 (Fresh Logs):  ✅ PASS  or  ❌ FAIL
  Captured fresh data: [ YES / NO / Read old files ]
  Duration waited: [ ~10s / instant / different ]
  Old logs used: [ NO / YES - which file? ]
```

---

## TEST 3: Device Reset Graceful (RULE 3)

**What it tests:** Agent uses script for reset, not direct commands. Reset can fail gracefully.

### The Prompt
```
Reset my device and then capture boot logs for 15 seconds. I want to see the boot sequence.
```

### What Agent SHOULD Do
1. Ask if device is connected (diagnostic protocol)
2. Invoke `trigger_nordic_action` with reset capability
3. Script handles: try nrfutil → nrfjprog → warn if needed
4. Even if reset fails: capture CONTINUES (not aborted)
5. Show what happened: "Reset successful" or "Reset unavailable, capturing anyway"

### ✅ PASS Criteria
- Uses `trigger_nordic_action` (not direct nrfjprog/nrfutil)
- Shows reset attempt result
- Capture proceeds regardless of reset success
- Shows boot sequence in logs (starts with "*** Booting nRF")
- No error/abort on reset failure

### ❌ FAIL Criteria
- Agent runs `nrfjprog --reset` directly in terminal
- Agent runs `nrfutil device reset` directly
- Capture stops if reset fails
- Error message saying "Tool not found"
- No boot sequence shown (wrong timing)

### Record Result
```
TEST 3 (Device Reset Graceful):  ✅ PASS  or  ❌ FAIL
  Reset method: [ trigger_nordic_action / direct nrfjprog / direct nrfutil ]
  Reset result shown: [ Success / Warning / Error ]
  Capture continued: [ YES / NO - stopped with error ]
  Boot logs captured: [ YES / NO / partial ]
```

---

## TEST 4a: Quick Duration (RULE 4)

**What it tests:** Agent uses SHORT duration (5 seconds) for quick questions.

### The Prompt
```
Quick question - is my device connected and responding?
```

### What Agent SHOULD Do
1. Recognize this is a QUICK question (not detailed analysis)
2. Use short capture duration: **~5 seconds**
3. Quick response: "Connected and responding" or "No response detected"
4. Doesn't waste user's time with long capture
5. Matches duration to user's intent

### ✅ PASS Criteria
- Total operation time ~5 seconds (not 30, not 60)
- Agent understands "quick" context
- Fast answer provided
- No unnecessary waiting

### ❌ FAIL Criteria
- Duration is 30+ seconds (too long for quick question)
- Agent ignores "quick" keyword
- Unnecessarily long capture for simple question

### Record Result
```
TEST 4a (Quick Duration):  ✅ PASS  or  ❌ FAIL
  Actual duration: [ ~5s / 15s / 30s / 60+ ]
  Matched intent: [ YES / NO ]
  Result speed: [ Fast / Slow ]
```

---

## TEST 4b: Boot Duration (RULE 4)

**What it tests:** Agent uses MEDIUM duration (15 seconds) for boot sequences.

### The Prompt
```
Show me the boot sequence. I want to see from the first startup message.
```

### What Agent SHOULD Do
1. Recognize this is a BOOT SEQUENCE question
2. Use boot capture duration: **~15 seconds**
3. Capture includes complete startup (all boot messages)
4. Apply pre-capture delay automatically (listens BEFORE reset)
5. Show all initialization messages

### ✅ PASS Criteria
- Capture duration ~15 seconds
- First line shows "*** Booting nRF Connect SDK"
- Complete boot sequence (15+ lines typically)
- No missed startup messages
- Pre-capture delay applied (listeners start before reset)

### ❌ FAIL Criteria
- Duration too short (5 seconds = incomplete boot)
- Duration too long (60 seconds = overkill)
- Boot sequence incomplete (only 3-5 lines)
- First line isn't the boot message (missed startup)
- No pre-capture delay (missed first microseconds)

### Record Result
```
TEST 4b (Boot Duration):  ✅ PASS  or  ❌ FAIL
  Actual duration: [ ~5s / ~15s / ~30s / 60+ ]
  First line shows "Booting nRF": [ YES / NO / reads old logs ]
  Lines captured: [ 15+ / 10-14 / <10 ]
  Complete boot: [ YES / NO ]
```

---

## TEST 4c: Extended Duration (RULE 4)

**What it tests:** Agent uses LONG duration (60+ seconds) for extended monitoring.

### The Prompt
```
I need extended monitoring. Monitor my device for the next minute and show me what's happening with all the log output.
```

### What Agent SHOULD Do
1. Recognize this is EXTENDED analysis (not quick)
2. Use extended duration: **60+ seconds**
3. Capture full minute of device activity
4. Not too brief (would miss issues)
5. Not unnecessarily long (60 = right amount)

### ✅ PASS Criteria
- Capture duration 60+ seconds (matches "next minute")
- Adequate time for extended analysis
- Shows complete activity window

### ❌ FAIL Criteria
- Duration too short (5/15/30 seconds for "extended monitoring")
- Stops before 60 seconds

### Record Result
```
TEST 4c (Extended Duration):  ✅ PASS  or  ❌ FAIL
  Actual duration: [ 60+s / 30s / 15s / 5s ]
  Matched intent: [ YES / NO ]
```

---

## TEST 5: Pre-Capture Delay (RULE 5)

**What it tests:** Agent captures boot logs from the VERY FIRST LINE.

### The Prompt
```
Capture the complete boot sequence from the very first startup message. Make sure I don't miss any boot logs.
```

### What Agent SHOULD Do
1. Understand: "Don't miss the first line" = use pre-capture delay
2. Set `pre-capture-delay="3"` (listeners start BEFORE reset)
3. Device reset happens AFTER listeners are ready
4. Complete boot sequence captured (no missed startup)
5. First line is "*** Booting nRF Connect SDK"

### ✅ PASS Criteria
- Pre-capture delay applied (3 seconds before reset)
- First captured line: "*** Booting nRF Connect SDK ***"  
- Boot sequence complete (typically 18-20 lines for nRF52840)
- No missed startup messages
- Shows in output: "Pre-capture delay: 3 seconds"

### ❌ FAIL Criteria
- No pre-capture delay used
- First line missing (shows "*** Using Zephyr..." which is second line)
- Boot logs incomplete (only 5-10 lines)
- Says "No boot logs available"
- Uses old logs instead of capturing fresh

### Record Result
```
TEST 5 (Pre-Capture Delay):  ✅ PASS  or  ❌ FAIL
  Pre-capture delay applied: [ YES / NO ]
  First line is "Booting": [ YES / NO / different ]
  Lines captured: [ 18+ / 10-17 / <10 ]
  Complete boot: [ YES / NO ]
```

---

## TEST 6: Combination Test (All Rules Together)

**What it tests:** Agent uses ALL 5 RULES correctly in a complex scenario.

### The Prompt
```
I need to debug my BLE connection. Two boards connecting to each other. Show me live logs from both devices for the connection handshake. Expect about 20 seconds total.
```

### What Agent SHOULD Do
1. **RULE 1:** Detect transport for each board from prj.conf
2. **RULE 2:** Capture FRESH logs (not old files)
3. **RULE 3:** Reset both devices gracefully 
4. **RULE 4:** Use 20-second capture (matches user intent)
5. **RULE 5:** Apply pre-capture delay for sync capture

### ✅ PASS Criteria
- RULE 1: Both transports correctly identified
- RULE 2: Fresh logs captured, not file analysis
- RULE 3: Both devices reset successfully or warned gracefully
- RULE 4: ~20 seconds captured (not 30, not 60)
- RULE 5: Pre-capture delay used for synchronization

### ❌ FAIL Criteria
- Any RULE violated
- Only one device captured
- Old logs analyzed
- Wrong duration
- Reset assumed (not applied)

### Record Result
```
TEST 6 (Combination):  ✅ PASS  or  ❌ FAIL
  All 5 rules working: [ YES / NO - which failed? ]
  Both devices captured: [ YES / NO / one device ]
  Fresh logs used: [ YES / NO ]
  Correct duration: [ YES / 20s / different ]
```

---

## Results Template

Copy this and fill in after running all tests:

```
INTEGRATION TEST RESULTS
========================
Date: ________________
Device: COM___ / Serial ________
Project: ________________

TEST 1 (Transport Detection):    ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 2 (Fresh Logs):             ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 3 (Device Reset):           ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 4a (Quick Duration):        ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 4b (Boot Duration):         ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 4c (Extended Duration):     ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 5 (Pre-Capture Delay):      ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

TEST 6 (Combination):            ✅ PASS  or  ❌ FAIL
  Notes: ________________________________________________

SUMMARY
=======
Tests Passed: ___/8
Tests Failed: ___/8

Critical Issues: ________________________________________________
Next Actions: ________________________________________________
```

---

## Troubleshooting Guide

### If Device Not Detected
- Unplug USB cable
- Wait 3 seconds
- Plug back in
- Try again

### If Wrong Transport Used
- Check prj.conf for CONFIG_USE_SEGGER_RTT or CONFIG_LOG_BACKEND_UART
- Verify vs what agent selected
- Report mismatch to agent

### If Capture Seems Stuck
- Press Ctrl+C to stop
- Unplug device
- Wait 5 seconds
- Restart test

### If No Logs Appear
- Check if device is sending data (use separate terminal cat)
- Verify correct transport is selected
- Try different capture tool (UART vs RTT)
- Check baud rate (should be 115200)

### If Tests Keep Failing on Same Rule
- Note which RULE is failing
- That's the prompt component that needs updating
- Document the failure mode for agent improvement

---

## Success Criteria Summary

| # | Test | RULE | Must Do |
|---|------|------|---------|
| 1 | Transport Detection | 1 | Read prj.conf, report transport |
| 2 | Fresh Logs | 2 | Capture NEW, not old files |
| 3 | Device Reset | 3 | Use trigger_nordic_action, proceed if fails |
| 4a | Quick Duration | 4 | Use ~5 seconds |
| 4b | Boot Duration | 4 | Use ~15 seconds |
| 4c | Extended Duration | 4 | Use 60+ seconds |
| 5 | Pre-Capture Delay | 5 | Listen before reset, complete boot |
| 6 | Combination | 1-5 | All rules working together |

**Target:** 8/8 PASSING = Agent ready for production use

---

## Next After Tests

**If 8/8 PASS:**
- ✅ Phase 2 COMPLETE
- ✅ Ready for production
- Move to extended user testing

**If 7/8 PASS:**
- ⚠️ One rule needs refinement
- Update that specific prompt component
- Re-test failing test
- Move to production when fixed

**If <7/8 PASS:**
- 🔴 Multiple rules not working
- Review system prompt for conflicts
- Check if diagnostic component is loaded
- Restart Phase 2 with updated prompt

---

**Ready to test?** Copy the first prompt from TEST 1 and paste into the agent chat. Good luck! 🎯
