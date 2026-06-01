# Adsum Backend — Free-Tier Proxy API Contract (Stage 0)

**Status:** approved for implementation  
**Client:** `src/core/api/providers/adsum-free.ts`  
**Mock:** `scripts/adsum-mock-proxy.mjs`  
**Backend repo:** `adsumnetworks/adsum-backend` (private)

---

## Base URLs

| Environment | URL |
|---|---|
| Production | `https://api.adsumnetworks.com` |
| Staging | `https://api-staging.adsumnetworks.com` |
| Local dev | `http://localhost:7788` |

All endpoints are under `/v1/`.

---

## Authentication

The free tier uses the **install ID** as the credential. It is **not** a secret — it only gates quota, not data.

Every request must include **one of**:
```
Authorization: Bearer <install_id>
X-Install-ID: <install_id>
```

The `install_id` format is `adsum-<uuidv4>` (e.g. `adsum-3f2a1b4c-...`).

---

## Endpoints

### `POST /v1/register-install`

Called once on first activation. Upserts the account.

**Request body:**
```json
{ "install_id": "adsum-3f2a1b4c-..." }
```

**Response `200`:**
```json
{
  "install_id": "adsum-3f2a1b4c-...",
  "quota": 500000,
  "tokens_used": 0
}
```

**Notes:**
- Idempotent — calling again returns the current account state.
- `quota` is `STAGE0_QUOTA` from env. Start conservative (~500K tokens = ~1–2 task-runs). Tune after measuring.

---

### `POST /v1/chat/completions`

OpenAI-compatible streaming chat completions, metered against the install quota.

**Request headers:**
```
Authorization: Bearer <install_id>
X-Install-ID: <install_id>
X-Task-ID: <ulid>           (optional, for debugging)
Content-Type: application/json
```

**Request body:** Standard OpenAI chat completions shape.
```json
{
  "model": "free-default",
  "messages": [...],
  "stream": true,
  "stream_options": { "include_usage": true },
  "tools": [...],
  "tool_choice": "auto"
}
```

The backend maps `"free-default"` → the configured provider model (e.g. `deepseek-chat`). The client never specifies the real model name.

**Response `200` — streaming (SSE):**

Standard OpenAI streaming format (`data: {...}\n\n`, terminated by `data: [DONE]\n\n`).

**Required response header on every `200`:**
```
X-Free-Quota-Remaining: <integer>
```
The remaining token budget after this request. The client displays this live.

**Response `402` — quota exhausted:**

Return immediately, before calling the provider.

```json
{
  "reason": "quota_exhausted",
  "remaining": 0,
  "next": ["verify_email", "add_byok"]
}
```

**Additional response headers on `402`:**
```
X-Free-Quota-Remaining: 0
Content-Type: application/json
```

The client converts a `402` into a `QuotaExhaustedError` and renders a conversion card — not a raw error message.

**Response `401`:** Missing or malformed install_id.  
**Response `429`:** Rate limit exceeded (per install_id or per IP).  
**Response `5xx`:** Provider error — pass through the upstream status and body.

---

## Metering rules

1. **One-time quota.** No rolling window. `tokens_used` only increases. Exhausted = exhausted until tier upgrade.
2. **Always decrement against provider-reported usage**, never a client estimate. Read `usage.prompt_tokens + usage.completion_tokens` from the provider response.
3. **Atomic increment.** Use Redis `INCRBY tokens:{install_id}` so concurrent requests don't race.
4. **Quota check before the provider call.** Never call the provider if the account is already exhausted.
5. `STAGE0_QUOTA` is a server-side env var. Changing it affects new installs; existing accounts keep their original quota unless explicitly migrated.

---

## Provider routing (Stage 0)

The router is a thin module mapping logical model names to providers:

| Logical model | Provider | Real model |
|---|---|---|
| `free-default` | DeepSeek | `deepseek-chat` |

**Prompt caching:** Keep the system prompt as a stable prefix across calls to exploit DeepSeek's cache discount (~98% discount on cached input tokens). Do not reorder or templatize the prefix per-request.

The router interface is swappable — when provider count grows, drop in self-hosted LiteLLM behind it without changing the metering service.

---

## Data schema (Postgres)

```sql
-- One row per install
CREATE TABLE accounts (
  id           SERIAL PRIMARY KEY,
  install_id   TEXT UNIQUE NOT NULL,
  email        TEXT,
  tier         TEXT NOT NULL DEFAULT 'anonymous', -- 'anonymous' | 'verified' | 'byok'
  token_quota  INTEGER NOT NULL,
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Durable usage history for audit + reconciliation
CREATE TABLE usage_events (
  id               SERIAL PRIMARY KEY,
  identity         TEXT NOT NULL,  -- install_id (Stage 0) or email (Stage 1+)
  model            TEXT NOT NULL,
  prompt_tokens    INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON usage_events (identity, ts);
```

---

## Redis key design

| Key | Type | Value | TTL |
|---|---|---|---|
| `quota:{install_id}` | String | current `tokens_used` | None (persistent) |
| `ratelimit:ip:{ip}` | String | request count | 60s sliding |
| `ratelimit:id:{install_id}` | String | request count | 60s sliding |

On `register-install`: `SET quota:{install_id} 0 NX` (don't reset existing).  
On inference: `INCRBY quota:{install_id} <tokens>`.  
Read remaining: `quota = STAGE0_QUOTA - GET quota:{install_id}`.

---

## Abuse controls

- Rate-limit per `install_id`: max 10 requests/minute.
- Rate-limit per source IP: max 30 requests/minute.
- Log installs where a single IP generates >5 distinct `install_id`s within 10 minutes.
- `STAGE0_QUOTA` kept small so reinstall abuse has bounded cost.

---

## Phase 1 stubs (define now, implement later)

These endpoints are included in the contract so the client can be built against them, but the backend can return `501 Not Implemented` until Phase 1 is built.

### `POST /v1/email/start`
```json
{ "install_id": "adsum-...", "email": "user@example.com" }
```
→ Send verification email, return `200 { "sent": true }` or `429` if rate-limited.

### `GET /v1/email/verify?token=<opaque>`
→ Validate token (single-use, 30-min TTL, hash-compared), upgrade account to `tier='verified'`, redirect to success page.

**Security requirements (for Phase 1 implementation):**
- Store only the **hash** of the verification token, not the raw token.
- Token is single-use: mark `used=true` on first click.
- 30-minute TTL enforced.
- Reject disposable-email domains (subscribe to a blocklist).
- Rate-limit sends per IP and per email address.

---

## Environment variables (backend)

```env
# Provider
DEEPSEEK_API_KEY=sk-...
FREE_MODEL=deepseek-chat
PROVIDER_BASE_URL=https://api.deepseek.com/v1

# Quota
STAGE0_QUOTA=500000

# Storage
REDIS_URL=redis://...
DATABASE_URL=postgresql://...

# Telemetry
POSTHOG_PROJECT_TOKEN=phc_...
POSTHOG_HOST=https://us.i.posthog.com

# Email (Phase 1)
EMAIL_PROVIDER_KEY=re_...
EMAIL_FROM=noreply@adsumnetworks.com
VERIFY_BASE_URL=https://api.adsumnetworks.com
```

---

## PostHog events (server-side)

The backend emits these events using `posthog-node` with `distinct_id = install_id`.

| Event | When |
|---|---|
| `free_tier.install_registered` | `register-install` called for a new install_id |
| `free_tier.quota_exhausted` | `chat/completions` returns 402 |

The remaining 5 events (`first_run_started`, `debug_cycle_completed`, `email_submitted`, `email_verified`, `byok_added`) are emitted client-side by `TelemetryService`.

---

## Testing against the mock

```bash
# Start the mock (canned responses, no DeepSeek key needed)
node scripts/adsum-mock-proxy.mjs

# Test registration
curl -X POST http://localhost:7788/v1/register-install \
  -H "Content-Type: application/json" \
  -d '{"install_id":"adsum-test-1234"}'

# Test inference (streaming)
curl -X POST http://localhost:7788/v1/chat/completions \
  -H "Authorization: Bearer adsum-test-1234" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-default","messages":[{"role":"user","content":"Hello"}],"stream":true}'

# Test 402 flow
node scripts/adsum-mock-proxy.mjs --exhaust
curl -X POST http://localhost:7788/v1/chat/completions \
  -H "Authorization: Bearer adsum-test-1234" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-default","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```
