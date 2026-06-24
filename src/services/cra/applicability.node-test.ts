import assert from "node:assert/strict"
import { test } from "node:test"
import { assessApplicability } from "./applicability"

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

test("config enabled (=y) but no symbol info → unknown (never claims affected)", () => {
	const v = assessApplicability({ gateSymbol: "CONFIG_BT_SMP" }, { dotConfig: "CONFIG_BT_SMP=y\n" })
	assert.equal(v.signal, "unknown")
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
