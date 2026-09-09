#!/usr/bin/env node
/**
 * Render-level verification of the launch-sweep rules, against the REAL built components.
 *
 *   node scripts/verify-sweep.mjs <out-dir>
 *
 * Every check drives a Storybook story in a real browser, performs the interaction the rule is
 * about, asserts on what is actually on screen (visibility, computed colour, text), and saves a
 * screenshot named for the rule. A failing check exits 1 with the rule named. This exists because
 * a DOM assertion in jsdom proves the wiring; it does not prove the pixel — and the bug that
 * started this sweep was seen on a screen, not in a test.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "storybook-static")
const OUT = path.resolve(process.argv[2] ?? "/tmp/sweep-verify")
mkdirSync(OUT, { recursive: true })

const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
}
const server = http.createServer((req, res) => {
	const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]))
	const f = existsSync(p) && statSync(p).isDirectory() ? path.join(p, "index.html") : p
	if (!existsSync(f)) {
		res.writeHead(404)
		return res.end()
	}
	res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" })
	createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const WARNING = "rgb(210, 153, 34)" // BRAND_WARNING #D29922
const browser = await chromium.launch()
const results = []

const THEME = process.env.THEME ?? "vs_dark"
async function story(id, theme = THEME) {
	const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
	const errors = []
	page.on("pageerror", (e) => errors.push(String(e)))
	await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${id}&globals=theme:${theme}`, { waitUntil: "networkidle" })
	await page.waitForTimeout(1800)
	return { page, errors }
}
async function shot(page, name) {
	await page.screenshot({ path: path.join(OUT, `${name}-${THEME}.png`), fullPage: false })
}
function check(name, ok, detail) {
	results.push({ name, ok, detail })
	console.log(`${ok ? "  ✔" : "  ✖"} ${name}${detail ? `  — ${detail}` : ""}`)
}

// ── 1. the exception line ──────────────────────────────────────────────────────────────────
{
	const { page, errors } = await story("views-chat--entry-esp-not-answering")
	const ex = page.getByTestId("envstrip-exception")
	const visible = await ex.isVisible().catch(() => false)
	const text = visible ? await ex.innerText() : ""
	const color = visible
		? await ex
				.locator("span")
				.last()
				.evaluate((el) => getComputedStyle(el).color)
		: ""
	check("01 exception line renders when a device will not answer", visible && /not answering/.test(text), text.trim())
	check("01 exception line is in the semantic warning colour", color === WARNING, color)
	// and the ordinary summary rows are NOT also shown — the exception replaces them
	const summaryBadges = await page.locator('[data-testid="envstrip-summary"] >> text=/^(nRF|ESP)$/').count()
	check("01 the exception REPLACES the summary rather than stacking on it", summaryBadges <= 1, `${summaryBadges} badge(s)`)
	check("01 no page errors", errors.length === 0, errors[0])
	await shot(page, "01-exception-line")
	await page.close()
}

// ── 2. one notice at a time ────────────────────────────────────────────────────────────────
{
	const { page, errors } = await story("views-chat--entry-notices-stacked")
	const ids = ["cra-nudge", "unlocked-card", "dock-coach-mark", "upgrade-card", "review-nudge"]
	const shown = []
	for (const id of ids)
		if (
			await page
				.getByTestId(id)
				.isVisible()
				.catch(() => false)
		)
			shown.push(id)
	check("05 exactly one notice renders with three eligible", shown.length === 1, shown.join(", ") || "none")
	check("05 and it is the receipt — the answer to what they just did", shown[0] === "unlocked-card", shown[0])
	check("05 no page errors", errors.length === 0, errors[0])
	await shot(page, "05-one-notice")
	// dismiss it: the NEXT one in the queue should take the slot, not nothing and not two
	const dismiss = page.getByTestId("unlocked-dismiss")
	if (await dismiss.isVisible().catch(() => false)) {
		await dismiss.click()
		await page.waitForTimeout(400)
		const after = []
		for (const id of ids)
			if (
				await page
					.getByTestId(id)
					.isVisible()
					.catch(() => false)
			)
				after.push(id)
		// dismissal is a backend call in the real product, mocked here — so the receipt may remain;
		// what must NEVER happen is two at once.
		check("05 after dismiss, still never more than one", after.length <= 1, after.join(", ") || "none")
		await shot(page, "05-after-dismiss")
	}
	await page.close()
}

// ── 6. the strip: shows, dismisses, returns when low; the chip reads Free tier ──────────────
{
	const { page, errors } = await story("views-chat--entry-free-tier-healthy")
	const strip = page.getByTestId("free-tier-strip")
	check("06 strip shows on a healthy balance before dismissal", await strip.isVisible().catch(() => false))
	const chipText = await page
		.getByTestId("model-chip")
		.innerText()
		.catch(() => "")
	check("06 the model chip reads 'Free tier', not the internal id", /^Free tier/.test(chipText.trim()), chipText.trim())
	check("06 the chip does NOT leak 'adsum-free:free-default'", !/adsum-free|free-default/.test(chipText), chipText.trim())
	await shot(page, "06-strip-healthy")
	await page.getByTestId("free-tier-strip-dismiss").click()
	await page.waitForTimeout(300)
	check("06 dismiss hides the strip", !(await strip.isVisible().catch(() => false)))
	check(
		"06 the chip still carries the tier after dismissal",
		/^Free tier/.test((await page.getByTestId("model-chip").innerText()).trim()),
	)
	check("06 no page errors", errors.length === 0, errors[0])
	await shot(page, "06-strip-dismissed")
	await page.close()
}
{
	const { page, errors } = await story("views-chat--entry-free-tier-settled")
	check(
		"06 the strip has RETIRED once the install has task history",
		!(await page
			.getByTestId("free-tier-strip")
			.isVisible()
			.catch(() => false)),
	)
	const chip = await page
		.getByTestId("model-chip")
		.innerText()
		.catch(() => "")
	check("06 and the chip carries the tier on a settled install", /^Free tier/.test(chip.trim()), chip.trim())
	// The chip is the courtesy line once the strip has retired: balance, provider, and it READS as
	// Adsum's — cyan, not the host's grey. [OPERATOR 2026-09-09: "almost hidden, not like the mockup".]
	const chipFacts = await page
		.getByTestId("free-tier-chip")
		.evaluate((el) => {
			const cs = getComputedStyle(el)
			const tier = el.querySelector(".tier")
			// read the token where the chip reads it: the light value is set below the root, not on it
			const want = cs.getPropertyValue("--adsum-cyan-text").trim()
			const probe = document.createElement("span")
			probe.style.color = want
			document.body.appendChild(probe)
			const wantRgb = getComputedStyle(probe).color
			probe.remove()
			return {
				color: cs.color,
				wantRgb,
				edge: cs.borderTopColor,
				text: el.innerText.replace(/\s+/g, " ").trim(),
				tierClipped: tier ? tier.scrollWidth > tier.clientWidth + 1 : true,
			}
		})
		.catch((e) => ({ err: String(e) }))
	check(
		"06 the chip reads the balance — Free tier · 6.6M",
		/^Free tier · 6\.6M/.test(chipFacts.text ?? ""),
		chipFacts.text ?? chipFacts.err,
	)
	check("06 the chip names the courtesy", /courtesy of Adsum Networks/.test(chipFacts.text ?? ""), chipFacts.text)
	check(
		"06 the chip is in the brand's cyan TEXT token, not the host's grey",
		!!chipFacts.color && chipFacts.color === chipFacts.wantRgb,
		`${chipFacts.color} vs ${chipFacts.wantRgb}`,
	)
	check("06 the chip has a cyan edge", /rgba?\(0, 169, 206/.test(chipFacts.edge ?? ""), chipFacts.edge)
	check("06 the tier and balance never truncate at 420 px", chipFacts.tierClipped === false, JSON.stringify(chipFacts))
	await shot(page, "06-chip-courtesy")
	// The mockup draws the send arrow in cyan with the composer EMPTY ("Type a message…") — the
	// composer's own action, always there. Derived from the mockup's drawn ↑, not from a move; a
	// first cut asserted "muted while empty", which was my assumption and the product rightly failed it.
	const strokeOf = () =>
		page
			.getByTestId("send-button")
			.locator("svg")
			.evaluate((el) => getComputedStyle(el).stroke)
			.catch(() => "")
	const emptyStroke = await strokeOf()
	const ta = page.getByTestId("chat-input")
	await ta.click()
	await ta.pressSequentially("bring up the gateway")
	await page.waitForTimeout(300)
	const typedStroke = await strokeOf()
	check("06 send arrow is brand cyan on an empty composer, as drawn", emptyStroke === "rgb(0, 169, 206)", emptyStroke)
	check("06 and stays cyan with something to send", typedStroke === "rgb(0, 169, 206)", typedStroke)
	await shot(page, "06-send-cyan")
	check("06 no page errors", errors.length === 0, errors[0])
	await shot(page, "06-strip-settled")
	await page.close()
}
{
	const { page, errors } = await story("views-chat--entry-free-tier-low")
	// simulate the dismissal having happened earlier
	await page.evaluate(() => {
		try {
			localStorage.setItem("adsum.freeTierStripDismissed", "1")
		} catch {}
	})
	await page.reload({ waitUntil: "networkidle" })
	await page.waitForTimeout(1500)
	const strip = page.getByTestId("free-tier-strip")
	check("06 the strip RETURNS on a low balance even after dismissal", await strip.isVisible().catch(() => false))
	check(
		"06 and the low-balance strip cannot be dismissed",
		!(await page
			.getByTestId("free-tier-strip-dismiss")
			.isVisible()
			.catch(() => false)),
	)
	check("06 no page errors", errors.length === 0, errors[0])
	await shot(page, "06-strip-low")
	await page.close()
}

// ── 1b. the account chip is in the drawer, not in Environment ─────────────────────────────
{
	const { page, errors } = await story("views-chat--entry-registered-settled")
	const inEnv = await page
		.locator("text=Environment")
		.locator("xpath=..")
		.getByText(/Registered/)
		.count()
	check("01 the account chip is NOT inside the Environment caption", inEnv === 0, `${inEnv} found`)
	// ── one door ── [OPERATOR 2026-09-09, approved] no ☰ under the host's ＋ ↺ ⚙; the "All runs"
	// line is the only way into the drawer, and the drawer holds no session list (the host's ↺ does).
	check("07 there is no ☰ on the entry surface", (await page.getByTestId("entry-burger").count()) === 0)
	const doors = await page.getByTestId("entry-more-runs").count()
	const doorText = doors ? await page.getByTestId("entry-more-runs").innerText() : ""
	check(
		"07 exactly ONE door to the drawer, and it says All runs",
		doors === 1 && /^All runs/.test(doorText),
		doorText || `${doors} doors`,
	)
	await page.getByTestId("entry-more-runs").click()
	await page.waitForTimeout(400)
	const inDrawer = await page
		.getByTestId("entry-drawer")
		.getByText(/Registered/)
		.count()
	check("01 the account chip IS in the drawer", inDrawer >= 1, `${inDrawer} found`)
	check(
		"07 the drawer lists no sessions — those are the host's",
		(await page.getByTestId("entry-drawer-session").count()) === 0,
	)
	check(
		"07 the drawer's filter names what it filters",
		/runs and checks/.test(await page.getByTestId("entry-drawer-filter").getAttribute("placeholder")),
	)
	await shot(page, "07-one-door-drawer")
	check("01 no page errors", errors.length === 0, errors[0])
	await shot(page, "01-account-in-drawer")
	await page.close()
}

// ── 03 / 04 — one ranked home, cap 3, demo card until history ──────────────────────────────
{
	const { page, errors } = await story("views-chat--entry-registered-settled")
	const cards = await page.locator('[data-testid^="entry-run-"]:not([data-testid$="-subline"])').count()
	check("03 the surface shows at most three cards", cards <= 3, `${cards} cards`)
	check("03 there is no separate cellular group", (await page.getByTestId("cellular-group").count()) === 0)
	const more = page.getByTestId("entry-more-runs")
	check("03 the overflow link is there", await more.isVisible().catch(() => false), await more.innerText().catch(() => ""))
	check(
		"04 the demo card holds the surface while there is no history",
		await page
			.getByTestId("demo-hex-card")
			.isVisible()
			.catch(() => false),
	)
	await shot(page, "03-ranked-home")
	await more.click()
	await page.waitForTimeout(400)
	const locked = page.getByTestId("entry-drawer-run-locked")
	const n = await locked.count()
	const lockedText = n ? await locked.first().innerText() : ""
	check(
		"03 a registered account has exactly ONE locked run — the by-request BLG card",
		n === 1,
		`${n}: ${lockedText.replace(/\n/g, " ").slice(0, 60)}`,
	)
	check("03 and it says Request access, not Register", /Request access/.test(lockedText) && /BLG20/.test(lockedText))
	check("03 no page errors", errors.length === 0, errors[0])
	await shot(page, "03-drawer-locked-blg")
	await page.close()
}
{
	const { page, errors } = await story("views-chat--entry-free-tier-settled")
	check(
		"04 with history the demo card has left the surface",
		!(await page
			.getByTestId("demo-hex-card")
			.isVisible()
			.catch(() => false)),
	)
	const more = await page
		.getByTestId("entry-more-runs")
		.innerText()
		.catch(() => "")
	check("04 and the overflow link says where it went", /demo flash/.test(more), more)
	check("04 no page errors", errors.length === 0, errors[0])
	await page.close()
}
// ── T1 — the focal action of a running task wears the brand's action colour ──────────────
{
	const { page, errors } = await story("views-chat--tool-approval")
	const colourOf = (name) =>
		page
			.locator("vscode-button", { hasText: name })
			.evaluate((el) => getComputedStyle(el).backgroundColor)
			.catch(() => "")
	const bg = await colourOf("Approve")
	const other = await colourOf("Reject")
	check("T1 Approve is brand cyan 700, not the host's blue", bg === "rgb(0, 137, 168)", bg)
	check("T1 Reject stays the host's secondary", other !== "rgb(0, 137, 168)", other)
	check("T1 no page errors", errors.length === 0, errors[0])
	check(
		"07 no ☰ in the task header either — the host's ↺ is the door mid-task",
		(await page.getByTestId("session-burger").count()) === 0,
	)
	await shot(page, "T1-approve-cyan")
	await page.close()
}

await browser.close()
server.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} render checks passed → ${OUT}`)
if (failed.length) {
	console.log("FAILED:")
	for (const f of failed) console.log("  -", f.name, f.detail ?? "")
	process.exit(1)
}
