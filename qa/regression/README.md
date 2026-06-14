# K-bit Regression Suite (`qa/regression/`)

The repeatable regression battery for the **K-bit platform** (format/schema/linter, manifest/resolver,
authoring/inspect CLI, registry cache/fetch + trust boundary, and the read_file→registry fallback).
**Run it at every major step** (before/after each increment, before merging, before a release).

## Run it
```bash
npm run qa            # = bash qa/regression/run.sh  — local + offline, no creds
```
Exit code is **0 = all green**, non-zero = a regression (the failing step prints its last lines).

### What `run.sh` covers
| Step | Checks |
|---|---|
| `test:kbits` | schema · frontmatter · linter · deriveId · safety · authoring · inspect · **corpus regression** (node:test) |
| `test:registry` | RegistryClient · BitCache (content-addressed, hash-verified) · resolver **bundled→cache→fetch** · tamper-reject · offline · **P2.5 `loadBitByKbPath`** |
| `lint:kbits` | corpus lints with **0 errors** |
| `check-types` | `tsc --noEmit` clean |
| `biome lint` | `src/` clean (error level) |
| schema/manifest **in sync** | regenerate → `git diff --exit-code` (no drift). *Assumes a committed tree — run at a stable step.* |
| `package` | VSIX/esbuild build succeeds |
| `kbit` CLI | `ls` / `tree` / `lint` run |

## Not in `run.sh` (run deliberately)
- **Live-prod end-to-end** (reads are public, no creds):
  ```bash
  npx ts-node --transpile-only -P tsconfig.unit-test.json qa/regression/prod-e2e.ts [bit-id]
  ```
  Proves the real client↔registry round-trip (fetch→cache→hash-verify, offline cache-hit, and the
  P2.5 path→id→registry resolution) against `api.adsumnetworks.com`.
- **mocha suites** (`npm run test:unit` — ESP/platform/`iot_context_esp`/`DemoManager`, **1044 host tests**):
  yargs/ESM-blocked on Node 26 → run on **Node 22** (locally, not just CI):
  `export PATH="/opt/homebrew/opt/node@22/bin:$PATH" && npm run test:unit`.
- **webview** (`npm run test:webview`, **214 vitest tests**).

## Notes
- Human-readable procedure + the latest full results live in
  `adsum-planning/knowledge-bits/TEST-PROCEDURE.md`.
- The sync checks (`git diff --exit-code`) compare the committed artifacts against a fresh
  regenerate, so run the suite at a **committed** point (they'll flag your own un-committed
  manifest/schema edits as "drift" otherwise).
