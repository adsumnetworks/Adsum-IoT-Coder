#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# K-bit platform — regression battery. Run at EVERY major step.
#   npm run qa        (or:  bash qa/regression/run.sh)
#
# Local + offline (no network, no prod). node:test suites run on Node 26; the mocha
# suites (test:unit / DemoManager.test) are CI-only on Node 22 (yargs breaks on 26) — see README.
# The live-prod end-to-end is opt-in: qa/regression/prod-e2e.ts (reads are public, no creds).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2   # repo root
FAIL=0
LOG=/tmp/qa_step.log

run() { # name, command
	printf '── %-40s' "$1"
	if eval "$2" >"$LOG" 2>&1; then echo "✅ PASS"; else echo "❌ FAIL"; echo "   ┄ last lines ┄"; tail -15 "$LOG" | sed 's/^/   /'; FAIL=1; fi
}

echo "K-bit regression — $(git branch --show-current 2>/dev/null) @ $(git rev-parse --short HEAD 2>/dev/null)"

run "test:kbits (node:test)"        "npm run test:kbits"
run "test:registry (node:test)"     "npm run test:registry"
run "lint:kbits (0 errors)"         "npm run lint:kbits | grep -q '0 errors'"
run "check-types (tsc)"             "npm run check-types"
run "biome lint (src, errors)"      "npx biome lint --diagnostic-level=error src/"
run "schema.json in sync"           "npm run gen:kbit-schema >/dev/null && git diff --exit-code -- iot-knowledge/kbit.schema.json"
run "manifest.json in sync"         "npm run gen:kbit-manifest >/dev/null && git diff --exit-code -- iot-knowledge/manifest.json"
run "package (VSIX build)"          "npm run package"
run "kbit CLI (ls/tree/lint)"       "npm run kbit -- ls >/dev/null && npm run kbit -- tree >/dev/null && npm run kbit -- lint >/dev/null"

echo ""
if [ "$FAIL" -eq 0 ]; then
	echo "✅ ALL GREEN — safe to proceed."
else
	echo "❌ REGRESSIONS — fix before proceeding."
	echo "   (sync checks assume a committed tree — run at a stable/committed step.)"
	exit 1
fi
