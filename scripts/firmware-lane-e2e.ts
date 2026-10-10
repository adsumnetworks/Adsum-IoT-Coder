/**
 * [0.5 the firmware lane] End to end against the LIVE registry, with the extension's own download code.
 *
 *   npx ts-node --transpile-only -P tsconfig.unit-test.json scripts/firmware-lane-e2e.ts
 *
 * Callers are test accounts kept as token files, never in this file (the protection-matrix convention):
 *   anonymous   no header
 *   registered  ~/.config/adsum/matrix-registered.token  (a signed-in account with the registered tier only)
 *
 * It proves, for every published firmware version: the version is named to everyone and its files to no one
 * who may not download it; a registered account is entitled to the demo rungs; a download through
 * FirmwareClient + FirmwareStore lands every file with its hash, the licence and the receipt; a bearer alone
 * never opens the bytes (402); a token never opens a file it does not cover (403), and travels in its header
 * only (in the URL it opens nothing); the receipt is recorded
 * server side; a file altered after the download is noticed. Not part of `npm test`: it writes receipts for
 * the test account on production and needs the network. A caller whose token file is absent is "not run".
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { FirmwareClient, type FirmwareEntry } from "../src/services/firmware/FirmwareClient"
import {
	downloadFirmware,
	LICENCE_FILE,
	listLocalFirmware,
	RECEIPT_FILE,
	readLocal,
} from "../src/services/firmware/FirmwareStore"

const BASE = process.env.ADSUM_REGISTRY || "https://api.adsumnetworks.com"
const tokenFile = (n: string) => path.join(os.homedir(), ".config/adsum", n)
const REG = existsSync(tokenFile("matrix-registered.token"))
	? readFileSync(tokenFile("matrix-registered.token"), "utf8").trim()
	: ""

const withBearer =
	(token: string): typeof fetch =>
	(input, init = {}) => {
		const headers = new Headers(init.headers)
		if (token && !headers.has("Authorization")) {
			headers.set("Authorization", `Bearer ${token}`)
		}
		return fetch(input, { ...init, headers })
	}

let passed = 0
const check = async (name: string, fn: () => Promise<void>) => {
	try {
		await fn()
		passed++
		console.log(`  ✓ ${name}`)
	} catch (e) {
		console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`)
		process.exitCode = 1
	}
}

async function main() {
	console.log(`firmware lane e2e against ${BASE}`)
	const anon = new FirmwareClient(BASE, fetch)
	const reg = new FirmwareClient(BASE, withBearer(REG))
	const anonManifest = await anon.manifest()
	const versions = anonManifest.firmware
	console.log(`  published firmware: ${versions.map((v) => `${v.id}@${v.version}`).join(", ") || "none"}`)

	await check("every published version is named to an anonymous caller, with no file details", async () => {
		assert.ok(versions.length >= 2, "expected the BLG20x and LEW840x demo bundles")
		for (const v of versions) {
			assert.equal(v.entitled, false, `${v.id} entitled for anonymous`)
			assert.deepEqual(v.artifacts, [], `${v.id} leaked its files to anonymous`)
		}
		assert.equal(anonManifest.account, null)
	})

	await check("an anonymous caller cannot authorise a download (401, sign in)", async () => {
		await assert.rejects(() => anon.authorise(versions[0].id, versions[0].version), /sign in to download firmware/)
	})

	if (!REG) {
		console.log("  - registered caller: not run (no ~/.config/adsum/matrix-registered.token)")
		return
	}

	const regManifest = await reg.manifest()
	await check("the registered account is entitled to the demo rungs and sees their files", async () => {
		for (const v of regManifest.firmware.filter((f) => f.rung === "demo-hex")) {
			assert.equal(v.entitled, true, `${v.id} not entitled for a registered account`)
			assert.ok(v.artifacts.length > 0, `${v.id} shows no files to a holder`)
		}
	})

	const root = mkdtempSync(path.join(os.tmpdir(), "adsum-fw-e2e-"))
	const downloaded: Array<{ entry: FirmwareEntry; folder: string }> = []
	try {
		for (const entry of regManifest.firmware.filter((f) => f.entitled)) {
			const folder = path.join(root, "firmware", entry.family ?? "unknown", entry.version)
			await check(
				`${entry.id}@${entry.version}: download lands every file with its hash, the licence and the receipt`,
				async () => {
					const local = await downloadFirmware(reg, entry.id, entry.version, folder)
					assert.equal(local.intact, true)
					// The bundle's own licence is folded into the one written for the licensee: checked by content below.
					const bundleLicence = entry.artifacts.find((a) => a.path === LICENCE_FILE)
					for (const a of entry.artifacts.filter((x) => x.path !== LICENCE_FILE)) {
						const p = path.join(folder, a.path)
						assert.ok(existsSync(p), `${a.path} missing`)
						assert.equal(createHash("sha256").update(readFileSync(p)).digest("hex"), a.sha256, `${a.path} hash`)
					}
					const licence = readFileSync(path.join(folder, LICENCE_FILE), "utf8")
					assert.match(
						licence,
						new RegExp(`Licensed to: ${local.receipt.licensee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
					)
					assert.match(licence, /Watermark: [0-9a-f]{16}/)
					if (bundleLicence) {
						assert.doesNotMatch(licence, /summary; ask Adsum Networks/, "the bundle's own licence words are kept")
					}
					const receipt = JSON.parse(readFileSync(path.join(folder, RECEIPT_FILE), "utf8"))
					assert.equal(receipt.id, entry.id)
					assert.equal(receipt.version, entry.version)
					assert.equal(receipt.status, "active")
					// Every file, plus the licence written beside them when the bundle did not carry one.
					assert.equal(receipt.artifacts.length, entry.artifacts.length + (bundleLicence ? 0 : 1))
					assert.equal(readLocal(folder)?.intact, true, "a fresh folder must never read as altered")
					downloaded.push({ entry, folder })
				},
			)
		}

		await check("the workspace scan finds every downloaded version, intact", async () => {
			const locals = listLocalFirmware([root])
			assert.equal(locals.length, downloaded.length)
			assert.ok(locals.every((l) => l.intact))
		})

		await check("a bearer alone never opens the bytes (402)", async () => {
			const a = downloaded[0].entry.artifacts.find((x) => x.group) ?? downloaded[0].entry.artifacts[0]
			const r = await fetch(`${BASE}/v1/firmware/artifact/${a.sha256}`, { headers: { Authorization: `Bearer ${REG}` } })
			assert.equal(r.status, 402)
		})

		if (downloaded.length >= 2) {
			await check("a download token never opens a file of another version (403)", async () => {
				const [one, other] = downloaded
				const auth = await reg.authorise(one.entry.id, one.entry.version)
				const foreign = other.entry.artifacts.find((x) => !one.entry.artifacts.some((y) => y.sha256 === x.sha256))
				assert.ok(foreign, "no file unique to the other version")
				const r = await fetch(`${BASE}/v1/firmware/artifact/${foreign.sha256}`, {
					headers: { "X-Adsum-Firmware-Token": auth.token },
				})
				assert.equal(r.status, 403)
			})

			await check("a token in the URL opens nothing: it travels in its header only (402)", async () => {
				const [one] = downloaded
				const auth = await reg.authorise(one.entry.id, one.entry.version)
				const own = one.entry.artifacts.find((x) => x.group) ?? one.entry.artifacts[0]
				const r = await fetch(`${BASE}/v1/firmware/artifact/${own.sha256}?token=${encodeURIComponent(auth.token)}`)
				assert.equal(r.status, 402)
			})
		}

		await check("the receipts are recorded server side for the account", async () => {
			const r = await fetch(`${BASE}/v1/firmware/mine`, { headers: { Authorization: `Bearer ${REG}` } })
			assert.equal(r.status, 200)
			const mine = (await r.json()) as { receipts?: Array<{ kbit_id?: string; id?: string }> }
			const ids = new Set((mine.receipts ?? []).map((x) => x.kbit_id ?? x.id))
			for (const d of downloaded) {
				assert.ok(ids.has(d.entry.id), `${d.entry.id} has no receipt on the server`)
			}
		})

		await check("a file altered after the download is noticed", async () => {
			const d = downloaded[0]
			const a = d.entry.artifacts.find((x) => x.path.endsWith(".hex") || x.path.endsWith(".bin")) ?? d.entry.artifacts[0]
			writeFileSync(path.join(d.folder, a.path), "tampered")
			assert.equal(readLocal(d.folder)?.intact, false)
		})
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
	console.log(`${passed} checks passed${process.exitCode ? ", some FAILED" : ""}`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
