# UI Golden Rules — color, emphasis, state

> Repo-tracked law for the extension UI (the planning copy in `adsum-planning/design-system/ui-golden-rules.md`
> is gitignored, so this is the dev/CI-visible source). Palette tokens: `./brandColors.ts`.

## The law
**Coral = who we are. Cyan = what to do. Grey = not now. Semantic = status only — and color NEVER means a verdict.**
The axis is **emphasis/priority**, never "clickable vs not."

## Roles
- **Coral = identity & supporting context** — the **logo brandmark is coral** (`#D76947`), secondary-priority
  cards/icons/frames, nudge **framing**, warm accents. May be clickable (= secondary priority).
  ❌ Never the focal/primary CTA. ❌ Never "good/done/safe/compliant".
- **Cyan = action & active** (`#00A9CE` base, `#0089A8` on-fill, `#6FD2E6` text-on-dark) — the one focal action
  per view + every affordance (buttons, Run/Re-run links, **New** badge, active/hover, flow progress, demo entry).
  **One feature = one action-color across ALL surfaces.** Weights: *focal cyan* (sparing, ~1/view) vs
  *functional cyan* (links/badges, repeats).
- **Grey = not-now** — inactive/disabled/"soon"; opacity tiers (0.8 runnable / 0.5 disabled) reinforce, never
  replace, color.
- **Semantic** (success `#2EA043` · warning `#D29922` · error `#F85149`) = status only. 🔒 **Honesty bind:**
  brand + semantic colors never encode a verdict (no green=good/red=bad) in posture tables, diagrams, or reports.

## Canonical patterns
- **Nudge / banner** = **coral frame + cyan CTA + cyan actionable icon** (model: `UpgradeCard`). The frame is a
  supporting surface; the action is cyan.
- **Card grid** = primary/featured card cyan; secondary cards coral (`IntentCard`).
- **Sample/demo picker** = cyan focal contour on the one featured row; functional cyan Run links; grey "soon".

## Checklist (every new surface)
1. The ONE action → focal cyan. 2. Inline actions/links/badges/active → functional cyan. 3. Identity / secondary
/ frame / accent → coral (never focal CTA). 4. Inactive/soon → grey + dim. 5. Status → semantic, and no color = a
verdict. 6. Same feature in two action-colors anywhere → unify to one.

**Never hard-code a hex in a component — import the token from `brandColors.ts`.**
