# ⚡ NEXT STEPS - Agent Rules & System Prompt Updates

**Priority**: 🔴 HIGH - These fixes address the main bugs user reported

---

## What's Complete ✅

All technical fixes implemented and tested:
- ✅ nrfutil integration (modern Nordic tool)
- ✅ Pre-capture delay feature ready
- ✅ Transport auto-detection logic
- ✅ Auto-tests (12/12 passing)
- ✅ Windows compatibility verified
- ✅ Documentation consolidated (STATUS.md)

---

## What's NOT Complete 🔴

**System Prompt Rules** need to be updated to fix agent behavior:

### Bug #1: Agent Memory Loss - "Doesn't know anything"
**Symptom**: Agent asks "can you provide J-Link numbers?" after just capturing them  
**Cause**: System prompt not clear about what agent should remember  
**Fix Location**: System prompt components  
**Action**: Add explicit rules for session context retention

### Bug #2: Wrong Transport Selection - "UART using RTT logger"
**Symptom**: `Nordic Logger [RTT]: capture` shown for UART device  
**Cause**: System prompt not enforcing transport parameter  
**Fix Location**: `trigger_nordic_action` tool description  
**Action**: Add explicit examples of RTT vs UART selection

### Bug #3: Wrong Duration - "45s for quick test"
**Symptom**: Quick test captures 45 seconds instead of 5  
**Cause**: System prompt missing duration guidance  
**Fix Location**: System prompt rules section  
**Action**: Specify duration defaults (2-5s quick, 30-60s full)

### Bug #4: Old Logs - "Analyzes files instead of capturing"
**Symptom**: Agent reads old logs from `logs/` folder without capturing  
**Cause**: System prompt missing distinction between capture vs analyze  
**Fix Location**: System prompt log handling rules  
**Action**: Add rule: "NEW logs by default, old files only if user says so"

---

## System Prompt Updates Needed

### 📍 File Location
Primary location:
```
src/core/prompts/system-prompt/tools/trigger_nordic_action.ts
```

Also check variant overrides:
```
src/core/prompts/variants/gpt-5.ts
src/core/prompts/variants/hermes.ts
src/core/prompts/variants/glm.ts
src/core/prompts/variants/gemini.ts
```

### 📝 Updates Required

**1. Transport Selection Rule (in tool description)**

Current state: Mentions transport parameter but no guidance

Needed:
```typescript
// Add clear examples:
"When logging from device:
  - If CONFIG_USE_SEGGER_RTT present → use transport='rtt'
  - If CONFIG_LOG_BACKEND_UART present → use transport='uart'
  - If port is COM3/ttyACM0 → use transport='uart'
  - If device is 9-digit serial → use transport='rtt'
  - When unsure, let handler auto-detect from prj.conf"
```

**2. Duration Guidance (in prompt rules)**

Current state: Not documented

Needed:
```typescript
"Logging duration defaults:
  - Quick connection test: 3-5 seconds
  - Boot sequence capture: 10-20 seconds
  - Normal operation: 30-60 seconds
  - Problem investigation: 60+ seconds
  Choose based on investigation goal, not default."
```

**3. Pre-Capture Delay Usage (in tool examples)**

Current state: Parameter exists but agent doesn't use

Needed:
```typescript
"pre-capture-delay example:
  For boot logs: pre-capture-delay='3', duration='20'
  This ensures listeners start BEFORE device resets.
  Default 0 (no delay) for normal logging."
```

**4. Log Capture vs Analysis (in prompt rules)**

Current state: Not distinguished

Needed:
```typescript
"Log handling:
  - User says 'show me logs' or 'capture logs' → Always capture FRESH
  - User says 'analyze this log file' or 'analyze logs/' → Read files
  - Default: Assume 'capture fresh' unless files explicitly mentioned
  - Never analyze old logs without confirming with user first"
```

**5. Session Context Memory (in prompt rules)**

Current state: Agent forgets what was already done

Needed:
```typescript
"Session memory:
  - Remember device ports/serials from this session
  - Remember project's transport type (RTT or UART)
  - Remember which devices have been tested
  - Reuse this info for subsequent commands
  - Don't ask for info you already have in this session"
```

---

## Testing These Changes

After updating system prompt:

### Quick Validation
1. Run extension in debug mode
2. Connect Nordic device  
3. Ask: "Show me device logs"
   - ✅ Should capture fresh (not read logs/)
   - ✅ Should auto-detect correct transport
   - ✅ Should use 5-10s duration for first test
   - ✅ Should remember device info for next command

### Comprehensive Test
```bash
# 1. Run auto-tests still pass
cd assets/scripts && python test_logger_scripts.py

# 2. Compile extension
npm run compile

# 3. Run manual tests in debug mode
# Test 1: Agent detects transport correctly
# Test 2: Agent captures fresh logs
# Test 3: Agent remembers device from prior command
# Test 4: Agent uses appropriate duration
# Test 5: Agent uses pre-capture delay if needed
```

---

## Implementation Checklist

- [ ] Read `STATUS.md` section "CRITICAL AGENT RULES (System Prompt Updates Needed)"
- [ ] Update `trigger_nordic_action.ts` with Rule 1-3 (transport, duration, pre-capture)
- [ ] Update system prompt components with Rule 4-5 (log capture, session memory)
- [ ] Test transport detection: UART device → uart-logger, RTT device → rtt-logger
- [ ] Test log capture: `show me logs` → captures fresh, not reading files
- [ ] Test duration: Quick test uses 5s, not 45s
- [ ] Verify auto-tests still pass: `python test_logger_scripts.py`
- [ ] Compile and test in debug extension
- [ ] Mark as ready when all tests pass

---

## Timeline

**5 minutes**: Reading STATUS.md + understanding rules  
**15 minutes**: Updating system prompt  
**10 minutes**: Running tests and validation  
**Total**: ~30 minutes to fix all agent behavior issues

---

## Reference Material

**For system prompt updates**:
- See [STATUS.md](STATUS.md) - "CRITICAL AGENT RULES (System Prompt Updates Needed)" (Lines ~160-300)
- See [STATUS.md](STATUS.md) - "🎯 Proper Workflow Examples" (Lines ~400-470)

**For transport detection details**:
- See [STATUS.md](STATUS.md) - "Transport Detection Summary" (Lines ~330-350)

**For testing procedures**:
- See [STATUS.md](STATUS.md) - "✅ Tests Run Before Each Change" (Lines ~600-610)

---

## Current Status

**All tests**: ✅ 12/12 passing  
**All scripts**: ✅ Working correctly  
**System prompt**: 🔴 Needs updates  
**Agent behavior**: 🔴 Will improve after prompt updates  

🎯 **Next action**: Update system prompt with Rules 1-5 from STATUS.md
