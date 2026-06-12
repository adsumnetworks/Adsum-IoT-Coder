# K-bit Specification (`iot-knowledge/KBIT-SPEC.md`)

**Status:** v0 (P0a) · **Audience:** anyone authoring or reviewing a knowledge bit.

A **K-bit** is a self-contained, versioned unit of expert knowledge in `iot-knowledge/`: a **workflow** (ordered multi-step procedure), an **action** (atomic subroutine), or a **knowledge** doc (reference). This file turns the corpus's *implicit* conventions into a **checkable contract**: a required YAML frontmatter block + body house-style rules. The linter (`scripts/kbit-lint.ts`) enforces it; the canonical schema lives in `src/services/knowledge/kbit/schema.ts` (zod) and is mirrored to `iot-knowledge/kbit.schema.json` for editors.

> **Why a contract:** retrieval, the manifest/index, and (later) the marketplace only work if bits are *structurally consistent*. Hand-maintained indexes have already drifted from the files; an enforced schema + generated index fixes that class of bug.

---

## 1. Frontmatter

Frontmatter is a **single YAML block fenced by `---` at the very top of the file** (line 1). Note: bits use `---` as section dividers throughout the body — **only the leading block is frontmatter.**

### Required (every bit)
| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, author-namespaced slug, e.g. `adsum/nrf/workflows/add-feature`. **Identity is the id, not the path** — moving/renaming the file must not change the id. |
| `title` | string | Human title. |
| `type` | `workflow \| action \| knowledge` | The bit class (see §2). |
| `version` | semver | `MAJOR.MINOR.PATCH`. Bump per §4. |
| `owner` | `adsum-core \| adsum-extended \| community \| partner` | Who authored/owns it. |
| `author` | string | Author handle (Adsum-core bits: `adsum`). |
| `license` | SPDX id | e.g. `CC-BY-SA-4.0` (open content), `Apache-2.0`, or a proprietary marker. **Independent of delivery.** |
| `tier` | `community \| certified` | Review/quality gate (R1.5). `certified` = passed Adsum review/benchmark; Adsum-core bits are `certified`. (Free-vs-paid is an *entitlement* concern, not a static field in v0.) |
| `delivery` | `bundled \| downloaded` | Decided by **necessity**: `bundled` ⟺ Adsum-core AND required offline/first-run; everything else `downloaded`. |
| `domain` | string | e.g. `embedded-iot`, `cra`. |

### Conditional / type-dependent
| Field | When | Type | Meaning |
|---|---|---|---|
| `platform` | required unless cross-cutting | `nrf \| esp \| universal` | Target platform. Global bits (identity, universal rules) use `universal`. |
| `triggers` | **required if `type: workflow`** | string[] | Intent strings that route to this workflow (formalises the `**Triggered by:**` line). Forbidden on `action`/`knowledge` (actions are workflow-invoked; knowledge is referenced). |

### Optional
| Field | Type | Meaning |
|---|---|---|
| `soc` | string[] | e.g. `["nrf52840","nrf5340"]`. |
| `sdk` / `sdk_version` | string | e.g. `ncs` / `>=2.6`. Drives compatibility + retires hardcoded versions. |
| `requires` | string[] (bit ids) | **Graph edges** — formalises `MANDATORY SKILL LOAD: read_file → …` (§3). Every target must resolve. |
| `loaded_by` | string[] (bit ids) | Informational reverse edges ("called by"). |
| `last_verified` | `{ date: YYYY-MM-DD, env: string }` | Last real verification (e.g. `env: "NCS 3.2.1 / nrf52840dk"`). **Absent = unverified.** |
| `safety` | safety[] | Declared dangerous ops (§5). |
| `supersedes` | string (bit id) | This bit replaces another id (rename/merge). |
| `content_hash` | string | sha256 of the body — **computed by tooling** in P2 (distribution); omit when authoring. |

> `rules` and `index` files map to `type: knowledge` with `platform` set appropriately (a rule is reference knowledge the loader always injects; the platform index is a generated artifact in P0b).

---

## 2. Bit types

- **`workflow`** — the **only** legal task entry point. Numbered, ordered steps; carries `triggers`; pulls actions/other workflows via `requires`.
- **`action`** — an atomic subroutine, **invoked only by a workflow** (`requires`). Never a task's first load. No `triggers`.
- **`knowledge`** — reference (SDK, board, protocol, rules, index). Loaded by the workspace gate or referenced by a bit. No `triggers`.

## 3. The `requires` edge convention

Today bits link via prose: `**MANDATORY SKILL LOAD:** read_file → platforms/nrf/actions/find-sample.md`. That stays in the body (it's the agent instruction), **and** the relationship is declared in frontmatter as a resolvable id:

```yaml
requires:
  - adsum/nrf/actions/find-sample
  - adsum/nrf/workflows/debug-loop
```

The linter checks every `requires` target exists (killing stale/asymmetric prose cross-refs). The dependency graph + the platform index are **generated** from these edges (P0b) — never hand-maintained.

## 4. Versioning

- **patch** — typo/clarity/non-behavioural.
- **minor** — improved guidance, same contract (`triggers`, `requires`, `safety` unchanged).
- **major** — contract change (triggers/requires/safety changed, renamed, removed).
- `sdk_version` expresses compatibility; the resolver later picks the **newest compatible** version (P2).

## 5. `safety` taxonomy (declared dangerous ops)

If a bit's body (or a bundled script it calls) performs a dangerous op, it **must** be declared:

`shell` · `flash` · `erase` · `network` · `fs-write` · `process-kill` · `long-running`

The linter scans for the obvious markers (`west flash`, `--erase`, `pkill`/`taskkill`, …) and **fails** if found but undeclared. (Transitive safety through `requires` is computed by tooling later; declare **direct** ops here.)

## 6. Body house-style (carried from the existing corpus)

- **Self-naming H1:** `# <Title> (<relative/path.md>)`.
- **Numbered Steps** (workflows) / **Phases** (loops); imperative voice addressed to *the agent*.
- **Honesty rules:** "logs are truth"; never guess roles/params; extract the key error line (don't dump raw output); a heuristic is "⚠️ review", never a verdict; a ✅ means "configured/present", never "correct".
- **Button-driven UX:** offer next steps via `ask_followup_question` options; never nest it inside `attempt_completion`.
- **Terminology lock:** "Build"/"Flash" (never "compile"/"deploy"); never expose internal tool names to the user.
- **Tool routing:** SDK commands via the platform device tool; host ops via `execute_command`; reads via `read_file`/`search_files`.
- **Completion:** `attempt_completion` result = one sentence; use `<!--TASK_COMPLETE-->` where a workflow defines autonomous completion.

---

## 7. Worked examples (one per type — proves the schema fits the corpus)

**Workflow** (`add-feature` — the P0a reference migration):
```yaml
---
id: adsum/nrf/workflows/add-feature
title: Add Feature
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
sdk: ncs
triggers: ["add a feature", "Add a feature to"]
requires:
  - adsum/nrf/actions/find-sample
  - adsum/nrf/workflows/debug-loop
loaded_by:
  - adsum/nrf/workflows/prototype
safety: [flash]   # transitively via debug-loop; declared so the linter is satisfied
---
```

**Action** (`flash`):
```yaml
---
id: adsum/nrf/actions/flash
title: Flash Firmware
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
sdk: ncs
requires: [adsum/nrf/actions/build]
safety: [flash, erase, process-kill]
---
```

**Knowledge** (`device-identity` rule):
```yaml
---
id: adsum/nrf/rules/device-identity
title: Device Identity Rule
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
---
```

**Global knowledge** (`AGENT` — cross-platform):
```yaml
---
id: adsum/agent
title: Identity & Persona
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: universal
---
```

---

## 8. How it's checked / used

- **Linter** (`npm run lint:kbits`): leading-block extraction → schema validation → `requires`/link resolution → undeclared-dangerous-ops → H1-path (warn). Chained into `npm run lint` (CI).
- **Schema:** `src/services/knowledge/kbit/schema.ts` is canonical (zod); `iot-knowledge/kbit.schema.json` is **generated** from it (`npm run gen:kbit-schema`) and kept in sync by CI.
- **Migration:** P0a migrates `add-feature` as the reference. P0b migrates the rest and **generates** `PLATFORM.md`/`AGENT.md` indexes from frontmatter.
