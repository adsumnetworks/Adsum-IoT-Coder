# Activation UX overhaul — impact & coordination note

**Full plan:** `adsum-planning/activation-ux-overhaul-plan.md` (parent dir, non-git)
**Last updated:** 2026-06-05

This note tells you which files/areas this work touches so we don't collide.

---

## Branches

| Branch | Scope | Status |
|---|---|---|
| `feature/activation-wow-demo` | Layout bug fix + brand palette | Active — 2 items shipped |
| `feature/real-workspace-demo` | Real NUS workspace demo + card entry pattern | Upcoming |
| `feature/upgrade-reengagement` | Dormant-user upgrade card + WhatsNewModal rewrite | Upcoming (after demo branch) |

---

## File collision map

| Area | Files | Risk | Notes |
|---|---|---|---|
| **Chat welcome UI** | `webview-ui/src/components/chat/ChatView.tsx` | **HIGH** | Central orchestrator — coordinate before editing |
| | `webview-ui/src/components/chat/ModeSelector.tsx` | **HIGH** | Added `heading` prop; more props coming in item 4 |
| | `webview-ui/src/components/chat/DemoCard.tsx` | Medium | Will evolve for item 4 card pattern |
| **Brand theming** | `webview-ui/src/theme.css` | Medium | Added `--color-brand-*` vars — don't redefine |
| | `webview-ui/tailwind.config.mjs` | Medium | Added `brand-*` color utilities |
| | `webview-ui/src/components/chat/brandColors.ts` | Low | **New file** — single source of truth for brand hex |
| **Extension activation** | `src/common.ts` | **HIGH** | Will add `checkDemoAutoStart` alongside `checkWorktreeAutoOpen` |
| | `src/services/telemetry/TelemetryService.ts` | Low | Additive only — new `free_tier.upgrade_prompt_*` events |
| **Host bridge** | `src/hosts/vscode/hostbridge/workspace/` | Medium | New `addWorkspaceFolders` method coming |
| **Knowledge base** | `iot-knowledge/AGENT.md` | Medium | Demo scope-gate exception already added |
| | `iot-knowledge/platforms/nrf/rules/skill-loading.md` | Medium | Demo row already added |
| | `iot-knowledge/platforms/nrf/workflows/` | Low | New `demo-debug.md` coming |
| **Bundled assets** | `demo-scenarios/` | Low | Will rename `l3-t1/` → `nus-uart/` |
| | `.vscodeignore` | Low | May need new entries for sample projects |

---

## What's already shipped (do not revert)

- `webview-ui/src/components/chat/brandColors.ts` — new, all brand hex must come from here
- `webview-ui/src/theme.css` — `--color-brand-primary*` and `--color-brand-secondary*` added
- `webview-ui/tailwind.config.mjs` — `brand-*` utilities added
- `DemoCard.tsx`, `ModeSelector.tsx`, `QuotaExhaustedCard.tsx`, `AdsumFreeProvider.tsx` — no inline brand hex; all use `brandColors.ts`
- `ModeSelector.tsx` — has new `heading?: string` prop on the `inline` variant; keep it

---

## Sequencing

1. `feature/real-workspace-demo` lands first — it's the infra for items 4 & 5.
2. Items 1 & 2 (current branch) are safe to merge now and don't block anything.
3. Announce before touching `ChatView.tsx`, `common.ts`, or `ModeSelector.tsx` in parallel.
