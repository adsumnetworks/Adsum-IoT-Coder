# Nordic Instruction System: File References
## Where Each Rule Lives (For Developers)

---

## 📍 SINGLE SOURCE OF TRUTH

### Main Reference
**File:** `src/core/prompts/system-prompt/tools/NORDIC_INSTRUCTION_HANDBOOK.md` (735 lines)

**Contains:**
- ✅ 5 MANDATORY RULES (RULE 1-5) with detailed steps
- ✅ Why each rule matters + failure symptoms
- ✅ Platform-specific guidance (Windows/Linux/macOS)
- ✅ Board-specific guidance (nRF5x variants)
- ✅ NCS version guidance
- ✅ 5 mandatory tool patterns
- ✅ Decision tree algorithm
- ✅ Critical mistakes to avoid
- ✅ Variant-specific requirements

**Used by:** All variants, all LLMs, documentation

---

## 🔧 SYSTEM PROMPT INTEGRATION POINTS

### 1. Tool Specification (triggers_nordic_action.ts)
**File:** `src/core/prompts/system-prompt/tools/trigger_nordic_action.ts`

**References to Rules:**
- Line ~5: "See: NORDIC_INSTRUCTION_HANDBOOK.md" (handbook reference)
- Line ~30-150: 5 MANDATORY RULES (RULE 1-5) with detailed steps
- Line ~30: "RULE 1: TRANSPORT SELECTION - Auto-Detect First"
- Line ~45: "RULE 2: LOG CAPTURE vs ANALYSIS - Fresh Logs by Default"
- Line ~59: "RULE 3: DEVICE RESET - Let Script Handle Gracefully"
- Line ~69: "RULE 4: CAPTURE DURATION - Match Investigation Context"
- Line ~76: "RULE 5: PRE-CAPTURE DELAY - Catch Complete Boot Sequence"

**ALL variants use this tool spec** → so all get the mandatory rules

### 2. Next-Gen Variant (Advanced Models)
**File:** `src/core/prompts/system-prompt/variants/next-gen/template.ts`

**Rule References:**
- Line ~84-95: 5 MANDATORY NORDIC DEVELOPMENT RULES
- Each rule: 1-2 sentences + emphasis "MANDATORY: ..."
- Link to handbook for details

**Target:** Claude 4, GPT-5+, advanced reasoning models

### 3. XS Variant (Small Models)
**File:** `src/core/prompts/system-prompt/variants/xs/overrides.ts`

**Rule References:**
- Line ~36-41: MANDATORY NORDIC RULES (simplified to RULES 1-3)
- Each rule: 1 sentence max, action-oriented
- No advanced patterns (keep context small)

**Target:** Small local models, LLMs with limited context

### 4. Generic Variant (Fallback)
**File:** `src/core/prompts/system-prompt/variants/generic/config.ts`

**Rule References:**
- Inherits from trigger_nordic_action tool spec
- No variant-specific override (uses base rules)

**Target:** Unknown models, fallback scenario

### 5. Other Variants
**Files:**
- `variants/gpt-5/config.ts`
- `variants/gemini-3/config.ts`
- `variants/hermes/config.ts`
- `variants/devstral/config.ts`
- `variants/glm/config.ts`
- `variants/native-gpt-5/config.ts`
- `variants/native-gpt-5-1/config.ts`
- `variants/native-next-gen/config.ts`

**Rule References:**
- All inherit from trigger_nordic_action tool spec
- No model-specific override needed (rules are universal)

---

## 📋 REFERENCE DOCUMENTS (For Team)

### Documentation Files
**SYSTEM_PROMPT_UNIFICATION_COMPLETE.md**
- What was the problem?
- How was it fixed?
- Files modified
- Verification checklist

**NEXT_ACTION_PLAN_AGENT_TESTS.md**
- 5 Agent System Tests
- Test procedures (step-by-step)
- Expected outputs
- Debug procedures
- Success criteria

**EXECUTIVE_SUMMARY.md**
- 1-page summary of problem & solution
- Key improvements
- Compilation status
- Next steps

**This file: FILE_REFERENCES.md**
- Where each rule lives
- How to find them
- How they're structured

---

## 🎯 FINDING RULES BY NUMBER

### RULE 1: Transport Detection
**Where to find:**
- ✅ NORDIC_INSTRUCTION_HANDBOOK.md → Line 50-67 ("RULE 1: TRANSPORT SELECTION")
- ✅ trigger_nordic_action.ts → Line 30-42 ("RULE 1: TRANSPORT...")
- ✅ next-gen/template.ts → Line 84-87 ("RULE 1: TRANSPORT...")
- ✅ xs/overrides.ts → Line 37 ("Read prj.conf FIRST...")

**Key Phrase:** "Read prj.conf first"

### RULE 2: Fresh Logs vs Old Files
**Where to find:**
- ✅ NORDIC_INSTRUCTION_HANDBOOK.md → Line 70-100 ("RULE 2: LOG CAPTURE...")
- ✅ trigger_nordic_action.ts → Line 45-54 ("RULE 2: LOG CAPTURE...")
- ✅ next-gen/template.ts → Line 89-91 ("RULE 2: LOG CAPTURE...")
- ✅ xs/overrides.ts → Line 38 ("Capture FRESH logs...")

**Key Phrase:** "Capture FRESH logs (not old files)"

### RULE 3: Device Reset
**Where to find:**
- ✅ NORDIC_INSTRUCTION_HANDBOOK.md → Line 103-130 ("RULE 3: DEVICE RESET")
- ✅ trigger_nordic_action.ts → Line 59-67 ("RULE 3: DEVICE RESET...")
- ✅ next-gen/template.ts → Line 93-95 ("RULE 3: DEVICE RESET...")
- ✅ xs/overrides.ts → Line 39 ("Use log_device action...")

**Key Phrase:** "Use trigger_nordic_action (NOT nrfjprog)"

### RULE 4: Duration
**Where to find:**
- ✅ NORDIC_INSTRUCTION_HANDBOOK.md → Line 133-159 ("RULE 4: CAPTURE DURATION")
- ✅ trigger_nordic_action.ts → Line 69-74 ("RULE 4: CAPTURE DURATION...")
- ✅ next-gen/template.ts → Line 97-101 ("RULE 4: DURATION...")
- ✅ xs/overrides.ts → Line 40 ("Match duration to investigation...")

**Key Phrase:** "5s quick | 15s boot | 30s standard | 60+s extended"

### RULE 5: Pre-Capture Delay
**Where to find:**
- ✅ NORDIC_INSTRUCTION_HANDBOOK.md → Line 162-184 ("RULE 5: PRE-CAPTURE...")
- ✅ trigger_nordic_action.ts → Line 76-85 ("RULE 5: PRE-CAPTURE...")
- ✅ next-gen/template.ts → Line 103-105 ("RULE 5: PRE-CAPTURE...")

**Key Phrase:** "Listeners start BEFORE reset"

---

## 🏗️ ARCHITECTURE

```
Handbook (Single Source)
    ↓
NORDIC_INSTRUCTION_HANDBOOK.md (735 lines - authoritative)
    ↓
    ├─→ trigger_nordic_action.ts (Tool Spec - reached by ALL variants)
    │       ↓
    │       ├─→ GENERIC variant (inherits)
    │       ├─→ NEXT-GEN variant + override (lines 84-105)
    │       ├─→ XS variant + override (lines 36-41)
    │       ├─→ GPT-5 variant (inherits)
    │       ├─→ GEMINI-3 variant (inherits)
    │       └─→ (other variants inherit)
    │
    └─→ Documentation (reference/team)
            ├─→ SYSTEM_PROMPT_UNIFICATION_COMPLETE.md
            ├─→ NEXT_ACTION_PLAN_AGENT_TESTS.md
            ├─→ EXECUTIVE_SUMMARY.md
            └─→ FILE_REFERENCES.md (this file)
```

**Key Point:** Handbook is at the top → all paths lead back to it

---

## 🔍 HOW AGENTS FIND THE RULES

### Step 1: Agent Context Loaded
Agent receives system prompt for their variant (next-gen, generic, xs, etc.)

### Step 2: Agent Reads Tool Spec
All variants include `trigger_nordic_action` tool
**→ Agents see the 5 MANDATORY RULES here first**

### Step 3: Optional Deep Dive
Handbook reference in tool spec:
```
⚠️ INSTRUCTION HANDBOOK (MANDATORY REFERENCE):
  See: NORDIC_INSTRUCTION_HANDBOOK.md in this directory
```

If agent is advanced (next-gen variant), it can fetch handbook for detailed patterns

### Step 4: Agent Follows Rules
Whether rules are read from tool spec or handbook:
- Same 5 RULES (RULE 1-5)
- Same mandatory language ("REQUIRED", "FORBIDDEN", "YOU MUST")
- Same consequences for violations

---

## 📁 QUICK DIRECTORY MAP

```
c:\Projects\AIDebug-Agent\
├─ src/
│  └─ core/
│     └─ prompts/
│        └─ system-prompt/
│           ├─ tools/
│           │  ├─ trigger_nordic_action.ts ⭐ (RULE 1-5 used by ALL variants)
│           │  └─ NORDIC_INSTRUCTION_HANDBOOK.md ⭐ (Single source of truth)
│           └─ variants/
│              ├─ generic/config.ts (inherits base spec)
│              ├─ next-gen/template.ts (+ override for advanced models)
│              ├─ xs/overrides.ts (+ simplified for small models)
│              ├─ gpt-5/config.ts (inherits)
│              ├─ gemini-3/config.ts (inherits)
│              ├─ hermes/config.ts (inherits)
│              ├─ devstral/config.ts (inherits)
│              └─ glm/config.ts (inherits)
│
├─ nrf-doc/
│  └─ NRF52_BEST_PRACTICES_GUIDE.md (reference guide - still valid)
│
└─ docs/
   ├─ SYSTEM_PROMPT_UNIFICATION_COMPLETE.md (what changed & why)
   ├─ NEXT_ACTION_PLAN_AGENT_TESTS.md (5 test procedures)
   ├─ EXECUTIVE_SUMMARY.md (1-page overview)
   ├─ FILE_REFERENCES.md (this file - where rules live)
   └─ [other docs]
```

---

## 🚀 FOR DEVELOPERS: How to Update Rules

### If you need to update RULE 1 (Transport Detection)

**Step 1: Find the rule**
- Location: NORDIC_INSTRUCTION_HANDBOOK.md line 50-67
- Also in: trigger_nordic_action.ts line 30-42

**Step 2: Update the handbook FIRST**
- Edit NORDIC_INSTRUCTION_HANDBOOK.md
- This is the authoritative source

**Step 3: Update trigger_nordic_action.ts**
- Sync the rules in tool spec with handbook
- This ensures all variants get updates

**Step 4: Consider variant-specific needs**
- If change affects small models → update xs/overrides.ts
- If change affects advanced models → update next-gen/template.ts
- If it's universal → no variant-specific changes needed

**Step 5: Compile and test**
- `npm run compile` (verify no TypeScript errors)
- Run 5 agent system tests (verify compliance)

### Example Update Workflow
```
1. Edit NORDIC_INSTRUCTION_HANDBOOK.md (change RULE 1)
2. Edit trigger_nordic_action.ts (sync with handbook)
3. [optional] Edit next-gen/template.ts (if advanced-specific)
4. [optional] Edit xs/overrides.ts (if small-model-specific)
5. npm run compile (verify)
6. Test with agent (verify behavior changed as expected)
```

---

## ✅ COMPLIANCE CHECKLIST

Before calling system prompt "done":

- [ ] Handbook created (NORDIC_INSTRUCTION_HANDBOOK.md)
- [ ] Handbook references 5 MANDATORY RULES (RULE 1-5)
- [ ] Handbook includes platform guidance (Windows/Linux/macOS)
- [ ] Handbook includes board guidance (nRF5x variants)
- [ ] trigger_nordic_action.ts references handbook
- [ ] trigger_nordic_action.ts has 5 MANDATORY RULES
- [ ] next-gen/template.ts has rule overrides
- [ ] xs/overrides.ts has simplified rules (1-3)
- [ ] All other variants inherit from trigger_nordic_action.ts
- [ ] Language is mandatory ("REQUIREMENT", "FORBIDDEN", "YOU MUST")
- [ ] Each rule has explicit consequences documented
- [ ] Agent tests verify compliance (5 tests)
- [ ] TypeScript compilation successful (0 errors)

---

## 📞 COMMON QUESTIONS

**Q: Where should I look if agent isn't following a rule?**  
A: Check trigger_nordic_action.ts first (base spec). All variants inherit from it.

**Q: If I need platform-specific rules, where do I add them?**  
A: NORDIC_INSTRUCTION_HANDBOOK.md has platform section (lines 189-219)

**Q: What's the difference between the handbook and variant templates?**  
A: Handbook is authoritative detail | Variants are model-specific shortcuts

**Q: Do I need to update all variants if I change a rule?**  
A: NO. Update trigger_nordic_action.ts (base spec) - all variants inherit automatically

**Q: How do I verify a rule change works?**  
A: Run the 5 agent system tests (NEXT_ACTION_PLAN_AGENT_TESTS.md)

---

**Last Updated:** 2026-02-09  
**Maintainer:** AIDebug Team  
**Status:** Active and in use for agent instruction compliance
