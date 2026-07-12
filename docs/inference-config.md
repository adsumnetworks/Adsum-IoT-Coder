# Inference / provider configuration

How Adsum IoT Coder chooses and configures the model that answers. This documents the provider system as it
shipped on `feat/glm-provider-ladder` (merged to `main` 2026-07-12).

## Goals

1. **Free tier just works** — a fresh install runs on Adsum's managed free tier with no config until quota is spent,
   then the picker restores the last-used config on reload.
2. **A short, curated, priority-ordered picker** — no upstream-Cline sprawl; only options an IoT developer needs.
3. **Capability-driven controls** — every panel exposes only what the selected model actually supports, and the
   thinking control matches each model's API (so we never send a parameter the model 400s on).

## Provider picker (order = priority)

`webview-ui/src/components/settings/ApiOptions.tsx` → `allowedProviders`:

| Rung | value | Label | Notes |
|---|---|---|---|
| 1 | `adsum-free` | Free tier (by Adsum Networks) | Managed; invite code only; fresh-install default |
| 2 | `zai-coding-plan` | GLM Coding Plan | Flat z.ai subscription; the "don't buy another sub" play |
| 3 | `anthropic` | Anthropic (Claude) | Native Claude catalog |
| 4 | `openrouter` | OpenRouter | Live model list |
| 5 | `openai` | OpenAI Compatible | Custom/self-host endpoints |
| 6 | `anthropic-compatible` | Anthropic Compatible | Non-Claude models over the Anthropic wire format |

The general metered **"Z AI"** provider was dropped (redundant with GLM Coding Plan + OpenRouter/OpenAI-compat).

Fresh-install default + last-config restore live in `src/core/storage/utils/state-helpers.ts`, gated on the
`FREE_TIER_STAGE0` feature flag (default **on**; `src/shared/services/feature-flags/feature-flags.ts`).

## Model catalogs

- **Anthropic (Claude)** — `src/shared/api.ts` `anthropicModels`: `claude-opus-4-8`, `claude-opus-4-7`,
  **`claude-sonnet-5` (default)**, `claude-haiku-4-5`. Retired 3.x/older removed (they 404).
- **GLM Coding Plan** — `zaiCodingPlanModels`: `glm-5.2` (default, 1M ctx), `glm-5-turbo`, `glm-4.7`. Flat ⇒ $0.
  Consumed via the **OpenAI-compatible coding endpoint** `https://api.z.ai/api/coding/paas/v4` (forced in the
  handler). A coding-plan key on the general `/paas/v4` returns z.ai error 1113.
- **OpenRouter** live (auto-refreshes). **OpenAI/Anthropic-Compatible** — user declares the model + specs.

Curated catalogs (Claude, GLM) are refreshed **manually per launch** — re-test when a vendor ships a new model.

## Thinking / reasoning control (capability-driven)

One helper decides which control a panel renders, so it always matches the model's API:

`webview-ui/src/components/settings/utils/thinkingControl.ts` → `getThinkingControl(provider, modelId, modelInfo)`
→ `"effort" | "budget" | "onoff" | "none"`.

| Model class | Control | Sends | Source of truth |
|---|---|---|---|
| Adaptive Claude (Opus 4.8/4.7, Sonnet 5) | On/off + **Effort** (low·medium·high·max, default medium) | `thinking:{type:"adaptive"}` + `output_config.effort` | `CLAUDE_ADAPTIVE_API_MODELS` (`src/shared/api.ts`) |
| Older Claude (Haiku 4.5) | On/off + **budget slider** | `thinking:{type:"enabled",budget_tokens}` | — |
| GLM | On/off; **Effort High/Max** on glm-5.2 (default max, z.ai recommends max for coding) | `thinking.type` (+ `reasoning_effort`) | `GLM_EFFORT_MODELS` (`src/shared/api.ts`) |
| Non-reasoning / unknown custom | hidden (unless flagged) | — | `modelInfo.supportsReasoning` |

Handlers: `src/core/api/providers/anthropic.ts` (adaptive vs budget + effort), `src/core/api/providers/zai.ts`
(`thinking.type` + gated `reasoning_effort`). Both are wired the whole way through `src/core/api/index.ts` using the
existing `planMode/actModeThinkingBudgetTokens` + `planMode/actModeReasoningEffort` fields.

**Model facts are single-sourced**: the adaptive-model set and effort levels live in `src/shared/api.ts` and are
imported by *both* the host handler and the settings UI, so they can never drift. `reasoning_effort`/`output_config`
are cast as body fields because the pinned `@anthropic-ai/sdk` (0.37.0) doesn't type them yet — the SDK forwards
unknown params to the REST API.

### Verified externally (2026-07)

- **Claude adaptive models 400 on `temperature`, `top_p`, `top_k`, and `budget_tokens`** → we send adaptive thinking
  + effort instead (P0 fix; was the latent bug the catalog refresh exposed).
- **GLM-5.2 `reasoning_effort`** is real (z.ai docs): values alias to two real depths, default `max`, **glm-5.2 only**
  (turbo/4.7 don't support it) → UI exposes **High/Max**, gated so turbo/4.7 never receive the param.

## Panel structure (consistent where it makes sense)

Connection → Model → **Advanced** (editable; only supported controls) → **Model info** (read-only capabilities +
pricing). The read-only section was renamed from "Advanced" → **"Model info"** globally
(`webview-ui/src/components/settings/common/ModelInfoView.tsx`) so "Advanced" only ever means editable. Free tier is
the deliberate exception (managed; invite only).

## Composer icons

`webview-ui/src/components/chat/ChatTextArea.tsx` — hand-built 24-viewBox SVGs (crisp at any zoom):
- **Send** = clean up-arrow "Lift" (cyan `#00A9CE`; muted `currentColor` when disabled).
- **Stop** = solid cyan squircle "Block" (cyan = action per the UI golden rules; replaced the grey-square-in-ring).

## Colour discipline (UI golden rules)

Cyan = action, coral = identity (brand/logo only), grey = not-now, semantic = status only. Send/Stop are actions →
cyan, never coral, even though "Claude Code" is associated with a coral spark.

## Operator verification still owed (LTS-Node env)

`npm run test:unit` (mocha breaks on the in-session Node 26 vs `.nvmrc` `lts/*`); reload/rebuild and eyeball:
Claude effort dropdown + Haiku budget slider, GLM on/off + glm-5.2 High/Max, "Model info" on every panel, new
send/stop icons; one live Sonnet-5 run (effort accepted, no 400) and one glm-5.2 run with effort on `/coding/paas/v4`.

## Backlog (parked)

1. **Live-scan reproducibility** — `triggerCveScan`'s `euvdCandidates` count is non-deterministic across runs and the
   tool overwrites the dated JSON; cite from the exact saved artifact and write report+scan atomically (kbit/tool).
2. **Surface GLM `reasoning_content`** — the zai handler drops it, so thinking is invisible and a slow first token
   reads as a frozen "Thinking…". Yield it as a reasoning block (host).
3. **Composer heartbeat + slow-provider warning** — show elapsed/"still working" while awaiting first token (z.ai
   glm-5-turbo TTFT tail hit ~107 s in testing); soft-warn if first token > 30 s.
4. China coding endpoint verification; identity headers (`X-Title: Cline` → Adsum) decision; get Adsum on z.ai's
   supported-tools list.
