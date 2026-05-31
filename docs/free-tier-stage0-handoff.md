# Free-Tier Inference — Stage 0 Implementation Handoff

**Branch:** `feature/free-tier-inference` (not merged to main — flag-gated)
**Backend repo:** `adsumnetworks/Adsum-Backend` (private)
**Live backend:** `https://api.adsumnetworks.com` (Railway)

---

## What was built

**Goal:** Let a new user complete a real debug cycle with zero configuration — no API key, no account. The free tier is for activation, not retention.

**Architecture:** Anonymous install ID → Adsum proxy → DeepSeek → streamed back to extension. Quota enforced server-side in Postgres. No Redis.

---

## Extension changes (`feature/free-tier-inference`)

### New files

| File | Purpose |
|---|---|
| `src/core/api/providers/adsum-free.ts` | New API provider. OpenAI-compatible client hitting `ClineEnv.config().adsumApiBaseUrl`. Sends `install_id` as Bearer token. Reads `X-Free-Quota-Remaining` header. Throws `QuotaExhaustedError` (message: `"adsum:quota_exhausted"`) on HTTP 402. |
| `src/services/adsum/InstallIdentity.ts` | Generates and persists a stable UUID in VS Code global state under `adsum.installId`, prefixed `adsum-<uuid>`. |
| `src/services/adsum/FreeTierService.ts` | `registerInstallIfNeeded()` — calls `POST /v1/register-install` on activation (idempotent, fire-and-forget). `shouldDefaultToFreeTier()` — logic for defaulting new installs to `adsum-free`. |
| `webview-ui/src/components/chat/QuotaExhaustedCard.tsx` | Conversion card shown on 402. Two buttons: "Add your own API key" (opens settings), "Verify email for more usage" (disabled — Phase 1 placeholder). Exports `QUOTA_EXHAUSTED_MARKER = "adsum:quota_exhausted"`. |
| `scripts/adsum-mock-proxy.mjs` | Local mock server (no deps, Node 18+). Run with `node scripts/adsum-mock-proxy.mjs`. Supports `--exhaust` flag to test 402 flow without a real backend. |
| `docs/backend/free-tier-proxy-spec.md` | Full API contract spec — endpoints, schemas, quota rules, Postgres schema, abuse controls, Phase 1 stubs. |

### Modified files

| File | Change |
|---|---|
| `src/config.ts` | Added `adsumApiBaseUrl` to `EnvironmentConfig`. Prod: `https://api.adsumnetworks.com`, staging: `https://api-staging.adsumnetworks.com`, local: `http://localhost:7788`. |
| `src/common.ts` | Calls `initializeInstallId(context)` and `registerInstallIfNeeded(context.globalState)` on activation (after feature flags polled). |
| `src/shared/api.ts` | Added `"adsum-free"` to `ApiProvider` union. |
| `src/core/api/index.ts` | Added `case "adsum-free": return new AdsumFreeHandler(...)` to handler switch. |
| `src/shared/providers/providers.json` | Added `{ "value": "adsum-free", "label": "Adsum Free Tier" }` at top of list. |
| `src/shared/services/feature-flags/feature-flags.ts` | Added `FREE_TIER_STAGE0 = "free-tier-stage0"` to `FeatureFlag` enum (default: `false`). |
| `src/core/storage/utils/state-helpers.ts` | Fresh installs default to `adsum-free` when `featureFlagsService.getBooleanFlagEnabled(FeatureFlag.FREE_TIER_STAGE0)` is true and no provider is already set. |
| `src/services/telemetry/TelemetryService.ts` | Added `FREE_TIER` event constants and 7 capture methods: `captureFreeTierInstallRegistered`, `captureFreeTierFirstRunStarted`, `captureFreeTierDebugCycleCompleted`, `captureFreeTierQuotaExhausted`, `captureFreeTierEmailSubmitted`, `captureFreeTierEmailVerified`, `captureFreeTierByokAdded`. |
| `webview-ui/src/components/chat/ErrorRow.tsx` | Checks `rawApiError?.includes(QUOTA_EXHAUSTED_MARKER)` before the `ClineError` parse path → renders `QuotaExhaustedCard` instead of a raw error. |
| `webview-ui/src/components/settings/ApiOptions.tsx` | Added `"adsum-free"` to `allowedProviders` list so it appears in the settings provider dropdown. |
| `biome.jsonc` | Added `src/services/adsum/InstallIdentity.ts` to the `use-cache-service` grit plugin exclusion list (legitimately uses `globalState` directly, same as `distinctId.ts`). |
| `src/hooks/useVSCodeTheme.ts` | **Bug fix:** `isDark()` now excludes `vscode-high-contrast-light` — previously treated Light High Contrast as dark, showing white logo on light background. |

---

## Backend (`adsumnetworks/Adsum-Backend`)

**Stack:** Fastify 4 + TypeScript + tsx runtime + Neon Postgres. No Redis — quota is Postgres-only (atomic `UPDATE … SET tokens_used = tokens_used + $1 RETURNING …`). In-memory rate limiting (10 req/min per install_id, 30/min per IP — resets on redeploy, acceptable for Stage 0).

### Endpoints

```
POST /v1/register-install     — upsert account, returns { quota, tokens_used }
POST /v1/chat/completions     — OpenAI-compatible SSE stream, metered
POST /v1/email/start          — 501 stub (Phase 1)
GET  /v1/email/verify         — 501 stub (Phase 1)
GET  /health                  — { status: "ok", env }
```

### Quota flow

1. `register-install` → upsert row in `accounts(install_id, token_quota, tokens_used)`
2. `chat/completions` → read `tokens_used` from Postgres → if exhausted return 402 → else forward to DeepSeek → stream back → post-stream atomic increment + write to `usage_events`
3. Every 200 response includes `X-Free-Quota-Remaining: <integer>` header

### 402 payload (what the extension renders as `QuotaExhaustedCard`)

```json
{ "reason": "quota_exhausted", "remaining": 0, "next": ["verify_email", "add_byok"] }
```

### Postgres schema

```sql
accounts(id, install_id UNIQUE, email, tier, token_quota, tokens_used, created_at, updated_at)
usage_events(id, identity, model, prompt_tokens, completion_tokens, ts)
```

### Provider

DeepSeek `deepseek-chat` → resolves to `deepseek-v4-flash`. Logical model name `"free-default"` in requests — backend maps it, client never knows the real model.

### Railway environment variables

| Key | Value |
|---|---|
| `DEEPSEEK_API_KEY` | *(set in Railway — temp key, needs permanent account)* |
| `FREE_MODEL` | `deepseek-chat` |
| `PROVIDER_BASE_URL` | `https://api.deepseek.com/v1` |
| `STAGE0_QUOTA` | `500000` |
| `DATABASE_URL` | *(Neon connection string — set in Railway)* |
| `NODE_ENV` | `production` |
| `PORT` | *(Railway injects automatically — currently 8080)* |

---

## Tier model

| Stage | Identity | Allowance | Status |
|---|---|---|---|
| **0** | Anonymous install ID | 500K tokens (~1–2 task-runs) | ✅ Built & live |
| **1** | Verified email | Larger allowance | 🔜 Phase 1 — stubs in place |
| **2** | BYOK key | Unlimited | ✅ Already built (existing provider system) |

---

## What's left before rollout

1. **PostHog:** Create feature flag key `free-tier-stage0` (exact match) → start at 0%
2. **PostHog:** Build funnel `install registered → first_run started → debug_cycle completed → byok added` with `tier` breakdown
3. **DeepSeek key:** Temp key in Railway — needs permanent account
4. **Railway trial:** $5 trial credit — migrate to Fly.io or upgrade before it expires
5. **Rollout:** Flip flag to 10% → measure for ~2 weeks → tune `STAGE0_QUOTA` based on real token-per-task data

---

## How to test locally

```bash
# Mock proxy — no infrastructure needed, canned responses
node scripts/adsum-mock-proxy.mjs

# Mock proxy — forward to real DeepSeek
DEEPSEEK_API_KEY=sk-... node scripts/adsum-mock-proxy.mjs

# Test 402 quota-exhausted flow
node scripts/adsum-mock-proxy.mjs --exhaust

# Then in VS Code launch.json:
# "CLINE_ENVIRONMENT": "local"
# Press F5 — extension hits http://localhost:7788
```

```bash
# Real backend locally
cd Adsum-Backend
cp .env.example .env   # fill in DEEPSEEK_API_KEY and DATABASE_URL
npm install
npm run dev            # starts on http://localhost:7788
```

```bash
# Smoke test against production
curl https://api.adsumnetworks.com/health
curl -X POST https://api.adsumnetworks.com/v1/register-install \
  -H "Content-Type: application/json" \
  -d '{"install_id":"adsum-test-001"}'
```

---

## Verification status

21-point exhaustive test run against live production backend — all PASS. Extension TypeScript clean, 155/155 webview regression tests pass.
