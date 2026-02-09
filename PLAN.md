# AIDebug-Agent: Development Plan & Checklist

**Last Updated:** 2026-02-09
**Status:** PHASE 1.5 COMPLETE - READY FOR AGENT SYSTEM TESTS  
**Priority Focus:** Agent System Tests (5 critical scenarios)

---

## ✅ PHASE 1.5 COMPLETE: System Prompt Unification & Rule Enforcement

### Major Accomplishments (Today)

| Task | Status | Impact |
|------|--------|--------|
| **Created NORDIC_INSTRUCTION_HANDBOOK.md** | ✅ DONE | Single source of truth (735 lines) |
| **Updated trigger_nordic_action.ts** | ✅ DONE | 5 MANDATORY RULES unified across all variants |
| **Updated variant templates (next-gen, xs)** | ✅ DONE | Consistent rules, platform guidance |
| **Fixed conflicting variant instructions** | ✅ DONE | No more agent confusion |
| **Added platform guidance** | ✅ DONE | Windows/Linux/macOS explicit |
| **Added board-specific configs** | ✅ DONE | nRF52840/5340/54H20 documented |
| **Changed language to MANDATES** | ✅ DONE | "YOU MUST FOLLOW" vs suggestions |
| **Auto-tests verification** | ✅ DONE | 12/12 passing |
| **TypeScript Compilation** | ✅ DONE | 0 errors |
| **Documentation created** | ✅ DONE | 5 reference files |

---

## 🚀 PHASE 2: Agent System Tests (NEXT - 30-45 min)

### 5 Critical Tests Ready to Run

### 4.1 Multi-Project Visibility
**Problem:** 2+ projects in workspace (peripheral_hr, central_hr) not tracked properly.

| Task | Status | Notes |
|------|--------|-------|
| **4.1.1:** Query `vscode.workspace.workspaceFolders` | 💻 TODO | Get all project paths |
| **4.1.2:** Display projects to agent | 💻 TODO | "peripheral_hr (nrf52840), central_hr (nrf52832)" |
| **4.1.3:** Cache project metadata (board, config) | 💻 TODO | Per-folder detection |
| **4.1.4:** Verify terminal `cd` changes work | ⏳ PEND | Test folder switching |
| **4.1.5:** Add explicit project selector | 💻 TODO | "Which project? (1/2)" |

---

### 4.2 Device-to-Project Mapping
**Problem:** Agent doesn't know which device↔board↔project. Flashes wrong project to wrong board.

**Example:**
```
Device 000682534033 (nrf52832) ← should flash central_hr
Device 000683007782 (nrf52840) ← should flash peripheral_hr
Agent: Builds both for 52840 ❌
```

| Task | Status | Notes |
|------|--------|-------|
| **4.2.1:** Detect board type from device SN | 💻 TODO | Query nrfutil or jlink |
| **4.2.2:** Scan prj.conf for board target | 💻 TODO | Extract `-b nrf52dk/nrf52840` |
| **4.2.3:** Create SN↔board mapping | 💻 TODO | Cache: `{"000682534033": "nrf52832"}` |
| **4.2.4:** Validate before flashing | 💻 TODO | "Flash central_hr (nrf52832) to 000682534033? (y/n)" |
| **4.2.5:** Alert on mismatch | 💻 TODO | "Board mismatch! Device is nrf52840 but project needs nrf52832" |

---

## 5. Flashing & Device Selection 🟡

### 5.1 Windows Timeout Handling
**Problem:** `timeout` command syntax differs Windows vs Linux. Agent tries wrapper that fails.

| Task | Status | Notes |
|------|--------|-------|
| **5.1.1:** Test Windows `timeout /T 10 /NOBREAK` | ⏳ PEND | Does syntax work? |
| **5.1.2:** Fallback to `Start-Sleep -Seconds 10` | 💻 TODO | PowerShell alternative |
| **5.1.3:** Abstract delay function | 💻 TODO | Cross-platform `delay(seconds)` |
| **5.1.4:** Remove timeout from west flash | 💻 TODO | Not usually needed |

---

### 5.2 Multi-Device Selection
**Problem:** `west flash` prompts user when 2+ boards connected. Agent should specify SN.

```
Please select one with desired serial number (1-2):
```

| Task | Status | Notes |
|------|--------|-------|
| **5.2.1:** Resolve device SN from mapping | ✅ DONE | Agent has SN from earlier |
| **5.2.2:** Check `west` `--serial-number` flag | ⏳ PEND | Does west support it? |
| **5.2.3:** Use nrfutil fallback if needed | 💻 TODO | `nrfutil device program --serial-number XXX` |
| **5.2.4:** Test flashing without prompt | 💻 TODO | Verify automated execution |

---

## 6. GitHub Actions 🔵

**Problem:** Auto-running workflows consume resources; need manual-only during dev.

| Task | Status | Notes |
|------|--------|-------|
| **6.1:** List all `.github/workflows/` files | ⏳ PEND | Identify auto-triggers |
| **6.2:** Disable push/PR triggers | 💻 TODO | Change to `workflow_dispatch` only |
| **6.3:** Keep manual critical workflows | 💻 TODO | Release, security scans |
| **6.4:** Document re-enablement | 📝 TODO | Instructions for production |
| **6.5:** Test manual dispatch works | ⏳ PEND | Verify dev can trigger |

---

## Implementation Priority

### 🔴 Phase 1: CRITICAL (Blockers)
- **1.1, 1.2:** UART timing & error handling
- **2.x:** Proto compilation (watch mode)

### 🟡 Phase 2: HIGH (Core)
- **3.x:** Cross-platform commands (enables multi-step ops)
- **1.3, 1.4:** RTT/UART detection & quick-test

### 🔵 Phase 3: NICE-TO-HAVE (Polish)
- **4.x:** Multi-project support
- **5.x:** Device selection UX
- **6.x:** GitHub Actions cleanup

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ DONE | Completed & tested |
| 💻 TODO | Ready to implement |
| ⏳ PEND | Awaiting info/testing |
| 🟡 IN PROGRESS | Currently being worked |
| 🔴 BLOCKED | Waiting for dependency |

---

## Testing Checklist (Per Task)

- [ ] UART capture: time-series correct?
- [ ] RTT auto-detected from prj.conf
- [ ] Quick-test (5s) shows data
- [ ] Multi-device: no user prompt
- [ ] Commands work on Windows
- [ ] Workspace projects tracked
- [ ] Device↔Board validated

---

## Related Files

| File | Purpose |
|------|---------|
| `assets/scripts/nrf_uart_logger.py` | UART capture |
| `assets/scripts/nrf_rtt_logger.py` | RTT capture |
| `src/core/task/tools/handlers/TriggerNordicActionHandler.ts` | Main handler |
| `src/platform/pythonDetector.ts` | Python detection |
| `.github/workflows/` | CI/CD |

---

**Created:** 2026-02-09  
**For handoff:** Copy this file to next chat when session exceeds 100K tokens.