# Archive Plan - Documentation Consolidation

**Status:** Ready to Archive  
**Date:** February 9, 2026  
**Reason:** Consolidating to 2 unified documents for clarity  

---

## Files to Archive (Keep for Reference Only)

These files are now superseded by `AGENT_STATUS.md` and `INTEGRATION_TESTS.md`:

### Archive List (Move to `.archive/` folder)

```
SYSTEM_PROMPT_UNIFICATION_COMPLETE.md
  → Purpose: Explained unification process (now in AGENT_STATUS.md)
  → Keep?: Reference only (archive)

NEXT_ACTION_PLAN_AGENT_TESTS.md
  → Purpose: Planning for agent tests (now in AGENT_STATUS.md + INTEGRATION_TESTS.md)
  → Keep?: Reference only (archive)

EXECUTIVE_SUMMARY.md
  → Purpose: High-level overview (now in AGENT_STATUS.md)
  → Keep?: Reference only (archive)

FILE_REFERENCES.md
  → Purpose: Where rules live (now documented in AGENT_STATUS.md)
  → Keep?: Reference only (archive)

TEST_PROMPTS_READY_TO_USE.md
  → Purpose: Test prompts (now detailed in INTEGRATION_TESTS.md)
  → Keep?: Can delete (fully replaced)
```

---

## Keep (Updated Now)

### New Unified Files

**AGENT_STATUS.md** (NEW)
- Current testing status
- Root cause analysis
- Next steps
- Metrics and success criteria
- **Updated Frequently** ← Single source of truth for agent status

**INTEGRATION_TESTS.md** (NEW)
- 7 test scenarios with detailed procedures
- Pre-test checklist
- Expected vs failure behaviors
- Results template
- Troubleshooting guide
- **Updated After Each Test Run** ← Reference for agent testing

---

## Large Reference Files (Keep as-is)

### nrf-doc/NRF52_BEST_PRACTICES_GUIDE.md
- **Status:** KEEP as reference documentation
- **Size:** 1195 lines (large but comprehensive)
- **Used by:** NORDIC_INSTRUCTION_HANDBOOK references it
- **Note:** Not active in system prompt (just reference)

### src/core/prompts/system-prompt/tools/NORDIC_INSTRUCTION_HANDBOOK.md
- **Status:** KEEP - single source of truth for RULES
- **Size:** 735 lines (well-organized)
- **Used by:** All system prompt variants reference this
- **Purpose:** Definitive guide for 5 RULES

---

## To Execute Consolidation

### Option 1: Gentle Archive (Keep for History)
```powershell
mkdir .archive/ -Force
move SYSTEM_PROMPT_UNIFICATION_COMPLETE.md .archive/
move NEXT_ACTION_PLAN_AGENT_TESTS.md .archive/
move EXECUTIVE_SUMMARY.md .archive/
move FILE_REFERENCES.md .archive/
move TEST_PROMPTS_READY_TO_USE.md .archive/
```

### Option 2: Delete (Clean Slate)
```powershell
rm SYSTEM_PROMPT_UNIFICATION_COMPLETE.md
rm NEXT_ACTION_PLAN_AGENT_TESTS.md
rm EXECUTIVE_SUMMARY.md
rm FILE_REFERENCES.md
rm TEST_PROMPTS_READY_TO_USE.md
```

---

## New Workflow

**Before:** 9 scattered markdown files with overlapping information  
**After:** 2 unified files with clear purposes

**AGENT_STATUS.md** = "Where are we now?"
- Check status before starting work
- Updated after each test iteration
- Shows progress, metrics, next steps

**INTEGRATION_TESTS.md** = "How do we test?"
- Reference while running tests
- Procedures for all 7 test scenarios
- Results template for recording outcomes

**Everything else:** Reference documentation (not active guidance)

---

## Compilation Status

✅ **Green Light**
- System prompt updated with diagnostics
- All TypeScript compiles (0 errors)
- Ready for next test iteration

---

## Next Steps

1. **Optional:** Run command above to archive/delete old files
2. **Deploy:** Load new system prompt in debug extension (F5)
3. **Test:** Run INTEGRATION_TESTS.md procedures with device
4. **Track:** Update AGENT_STATUS.md with results

---

**Files Consolidated:** 5 → 2 unified documents  
**Clarity Improved:** ✅ YES  
**Ready for Phase 2 Tests:** ✅ YES
