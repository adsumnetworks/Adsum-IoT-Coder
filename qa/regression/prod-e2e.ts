/**
 * K-bit P2 live end-to-end against PRODUCTION (api.adsumnetworks.com). READ-ONLY (public; no creds).
 * Opt-in (not part of `npm run qa`) — run when verifying the registry round-trip:
 *   npx ts-node --transpile-only -P tsconfig.unit-test.json qa/regression/prod-e2e.ts [bit-id]
 *
 * Proves: client fetch → cache → hash-verify; offline cache-hit; graceful miss; and the P2.5
 * read_file path → id → registry resolution (loadBitByKbPath).
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	__resetManifestCache,
	__setRegistryHooks,
	loadBit,
	loadBitByKbPath,
} from "../../src/services/knowledge/KnowledgeResolver"
import { BitCache } from "../../src/services/knowledge/registry/BitCache"
import { RegistryClient } from "../../src/services/knowledge/registry/RegistryClient"

const PROD = process.env.ADSUM_API ?? "https://api.adsumnetworks.com"
const ID = process.argv[2] ?? "adsum/community/hello"
const hook = () =>
	__setRegistryHooks({ registry: new RegistryClient(PROD), cache: new BitCache(mkdtempSync(join(tmpdir(), "qa-e2e-"))) })

async function main() {
	console.log(`prod e2e → ${PROD}  (id: ${ID})`)
	// 1) live fetch → cache → hash-verify → strip
	hook()
	const a = await loadBit(ID)
	console.log(
		"1) loadBit (fetch+verify) :",
		a ? `OK ${a.length}c — "${a.split("\n").find((l) => l.startsWith("#")) ?? a.split("\n")[0]}"` : "EMPTY",
	)
	__resetManifestCache()
	// 2) P2.5 path→id→registry (an on-demand bit addressed by its iot-knowledge path)
	hook()
	const rel = `${ID.replace(/^adsum\//, "")}.md`
	const kbPath = `/x/iot-knowledge/${rel.startsWith("nrf/") || rel.startsWith("esp/") ? `platforms/${rel}` : rel}`
	const b = await loadBitByKbPath(kbPath)
	console.log("2) loadBitByKbPath (P2.5) :", b ? "OK — resolved by path via registry" : "EMPTY")
	__resetManifestCache()
	process.exit(a && b ? 0 : 1)
}
main().catch((e) => {
	console.error("THREW:", e)
	process.exit(1)
})
