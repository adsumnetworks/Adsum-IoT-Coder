import assert from "node:assert/strict"
import { test } from "node:test"
import { assessApplicability, semverGte } from "./applicability"

test("config-gated-out: gating Kconfig '=n' → strong exclusion hint", () => {
	const v = assessApplicability(
		{ gateSymbol: "CONFIG_MBEDTLS_SSL_PROTO_TLS1_2" },
		{ dotConfig: "CONFIG_MBEDTLS_SSL_PROTO_TLS1_2=n\n" },
	)
	assert.equal(v.signal, "config-gated-out")
	assert.match(v.note, /verify/)
})

test("config-gated-out: '# CONFIG_X is not set' form", () => {
	const v = assessApplicability({ gateSymbol: "CONFIG_BT_SMP" }, { dotConfig: "# CONFIG_BT_SMP is not set\n" })
	assert.equal(v.signal, "config-gated-out")
})

test("config enabled (=y), no symbol info → config-present weak positive (design/28; never claims affected)", () => {
	const v = assessApplicability({ gateSymbol: "CONFIG_BT_SMP" }, { dotConfig: "CONFIG_BT_SMP=y\n" })
	assert.equal(v.signal, "config-present")
	assert.match(v.note, /may be reachable; verify/) // hedged — NOT "affected"
})

test("not-linked: code symbol absent from the image → strong exclusion hint", () => {
	const v = assessApplicability({ codeSymbol: "mbedtls_ssl_handshake" }, { symbols: "0001 T main\n0002 T printk\n" })
	assert.equal(v.signal, "not-linked")
	assert.match(v.note, /not in your built image/)
})

test("linked: code symbol present → WEAK signal ('may be reachable'), never 'affected'", () => {
	const v = assessApplicability({ codeSymbol: "mbedtls_ssl_handshake" }, { symbols: "0003 T mbedtls_ssl_handshake\n" })
	assert.equal(v.signal, "linked")
	assert.match(v.note, /may be reachable/)
	assert.doesNotMatch(v.note, /\b(affected|vulnerable|fixed|compliant)\b/i)
})

test("config-gate wins over symbol when both available (strongest exclusion first)", () => {
	const v = assessApplicability(
		{ gateSymbol: "CONFIG_X", codeSymbol: "foo" },
		{ dotConfig: "CONFIG_X=n\n", symbols: "0001 T foo\n" },
	)
	assert.equal(v.signal, "config-gated-out")
})

test("no hint → unknown (honest default, not a clean verdict)", () => {
	const v = assessApplicability(undefined, { dotConfig: "CONFIG_BT=y\n" })
	assert.equal(v.signal, "unknown")
	assert.match(v.note, /verify/)
})

test("every note ends in 'verify' and carries no conformity verdict word", () => {
	for (const v of [
		assessApplicability({ gateSymbol: "CONFIG_X" }, { dotConfig: "CONFIG_X=n" }),
		assessApplicability({ codeSymbol: "foo" }, { symbols: "bar" }),
		assessApplicability({ codeSymbol: "foo" }, { symbols: "foo" }),
		assessApplicability(undefined, {}),
	]) {
		assert.match(v.note, /verify/i)
		assert.doesNotMatch(v.note, /\b(compliant|certified|passes|fixed|resolved|clear)\b/i)
	}
})

test("config-present (design/28): gating Kconfig ENABLED → weak POSITIVE 'may be reachable; verify', never 'affected'", () => {
	const v = assessApplicability({ gateSymbol: "CONFIG_BT_SMP" }, { dotConfig: "CONFIG_BT_SMP=y\n" })
	assert.equal(v.signal, "config-present")
	assert.match(v.note, /enabled in your build/)
	assert.match(v.note, /may be reachable; verify/)
	// asymmetry held: gate DISABLED still excludes (config-gated-out wins over config-present)
	assert.equal(
		assessApplicability({ gateSymbol: "CONFIG_BT_SMP" }, { dotConfig: "# CONFIG_BT_SMP is not set\n" }).signal,
		"config-gated-out",
	)
})

test("fix-present (design/30 P2): fix commit in tree → patched (beats config-present); absent/unknown → falls through", () => {
	const hint = { gateSymbol: "CONFIG_BT_SMP", fixCommitSha: "a1b2c3d4e5f6a1b2" }
	const cfg = { dotConfig: "CONFIG_BT_SMP=y\n" }
	// fix IN tree → fix-present, even though CONFIG_BT_SMP=y would otherwise be config-present
	const v = assessApplicability(hint, cfg, true)
	assert.equal(v.signal, "fix-present")
	assert.match(v.note, /very likely already includes this fix; verify/)
	// fix ABSENT → not patched ≠ confirmed reachable; fall through to config-present
	assert.equal(assessApplicability(hint, cfg, false).signal, "config-present")
	// not checked → fall through too (never claims fix-present without a positive check)
	assert.equal(assessApplicability(hint, cfg, undefined).signal, "config-present")
})

test("design/32 version-fixed: build version at/past the fix → exclusion (very likely fixed; verify)", () => {
	const hint = { gateSymbol: "CONFIG_BT", fixedInVersion: "4.2.0" }
	// 4.2.99 >= 4.2.0 → version-fixed wins even though CONFIG_BT=y would otherwise be config-present.
	const v = assessApplicability(hint, { dotConfig: "CONFIG_BT=y" }, undefined, "4.2.99")
	assert.equal(v.signal, "version-fixed")
	assert.match(v.note, /4\.2\.99.*4\.2\.0.*very likely already fixed; verify/)
})

test("design/32 version-fixed: build version BEFORE the fix → falls back to config-present (may be reachable)", () => {
	const hint = { gateSymbol: "CONFIG_BT", fixedInVersion: "4.2.0" }
	const v = assessApplicability(hint, { dotConfig: "CONFIG_BT=y" }, undefined, "4.1.0")
	assert.equal(v.signal, "config-present")
})

test("design/32 version-fixed: no componentVersion → no false exclusion (stays config-present)", () => {
	const hint = { gateSymbol: "CONFIG_BT", fixedInVersion: "4.2.0" }
	assert.equal(assessApplicability(hint, { dotConfig: "CONFIG_BT=y" }, undefined, undefined).signal, "config-present")
})

test("design/32 semverGte: numeric major.minor.patch compare; unparseable → false (conservative)", () => {
	assert.equal(semverGte("4.2.99", "4.2.0"), true)
	assert.equal(semverGte("4.2.0", "4.2.0"), true)
	assert.equal(semverGte("4.1.9", "4.2.0"), false)
	assert.equal(semverGte("10.0.0", "9.9.9"), true)
	assert.equal(semverGte("abc-dirty", "4.2.0"), false) // a git SHA must never read as "fixed"
	assert.equal(semverGte("4.2.99", undefined), false)
})
