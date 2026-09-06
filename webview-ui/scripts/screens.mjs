#!/usr/bin/env node
/**
 * Contact sheet of the real components — the acceptance step for every UI change on this surface.
 *
 *   npm --prefix webview-ui run screens -- <out-dir> [story-id-prefix …]
 *
 * Builds Storybook, serves it from a throwaway static server, and photographs every story in the
 * matrix that actually matters here:
 *
 *   theme  vs_dark · vs_light   — the ONLY thing that separates them is a Storybook global. Setting
 *                                 Playwright's colorScheme instead renders dark twice and files one
 *                                 of them as "light", which is worse than not checking at all.
 *   width  420 · 820            — the sidebar and a wide editor tab. Every layout bug this surface
 *                                 has had was a short-string layout meeting a long string in a
 *                                 narrow column.
 *
 * A story that throws is NOT a passing screenshot: page errors are collected and the run exits 1 with
 * them named. The contact sheet is written as index.html beside the PNGs so the whole set can be
 * compared with the approved mockup in one scroll.
 */
import { spawnSync } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEBVIEW = path.resolve(HERE, "..")
const OUT = path.resolve(process.argv[2] ?? path.join(WEBVIEW, "screens"))
const ONLY = process.argv.slice(3)
const BUILD = path.join(WEBVIEW, "storybook-static")
const PORT = 6197

const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json",
}

/**
 * Which stories to photograph.
 *
 * Not every story: `index.json` carries hundreds, most of them upstream Cline components nobody on
 * this sprint changed, and a contact sheet nobody can scan is a contact sheet nobody reads. The
 * default is the Adsum-authored set plus the entry surface, which is exactly what this work touches.
 */
const DEFAULT_PREFIXES = ["adsum-", "views-chat--entry-"]

function stories() {
	const index = JSON.parse(readFileSync(path.join(BUILD, "index.json"), "utf8"))
	const wanted = ONLY.length ? ONLY : DEFAULT_PREFIXES
	return Object.values(index.entries)
		.filter((e) => e.type === "story" && wanted.some((p) => e.id.startsWith(p)))
		.map((e) => ({ id: e.id, name: `${e.title} · ${e.name}` }))
		.sort((a, b) => a.id.localeCompare(b.id))
}

function serve() {
	const server = http.createServer((req, res) => {
		let p = path.join(BUILD, decodeURIComponent(new URL(req.url, "http://x").pathname))
		if (existsSync(p) && statSync(p).isDirectory()) {
			p = path.join(p, "index.html")
		}
		if (!existsSync(p)) {
			res.writeHead(404)
			return res.end("not here")
		}
		res.writeHead(200, { "Content-Type": MIME[path.extname(p)] ?? "application/octet-stream" })
		createReadStream(p).pipe(res)
	})
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)))
}

function contactSheet(shots, errors) {
	const byStory = new Map()
	for (const s of shots) {
		byStory.set(s.id, [...(byStory.get(s.id) ?? []), s])
	}
	const rows = [...byStory.entries()]
		.map(
			([id, set]) => `<section><h2>${escapeHtml(set[0].name)}</h2><div class="ids">${escapeHtml(id)}</div>
<div class="grid">${set
				.map(
					(s) =>
						`<figure><img alt="${escapeHtml(s.name)} ${s.theme} ${s.width}" loading="lazy" src="${s.file}"/>
<figcaption>${s.theme} · ${s.width}px</figcaption></figure>`,
				)
				.join("")}</div></section>`,
		)
		.join("\n")
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Screens · Phase 1 Registered</title>
<style>
:root{color-scheme:light dark;--fg:#1b1f23;--muted:#57606a;--line:#d8dee4;--bg:#fff;--soft:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8b97a6;--line:#2a3340;--bg:#0f1419;--soft:#161c24}}
*{box-sizing:border-box}
body{margin:0;padding:26px;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1200px;margin:0 auto}
h1{font:500 1.4rem/1.2 "Iowan Old Style",Charter,Palatino,Georgia,serif;margin:0 0 .2rem}
.sub{color:var(--muted);font-size:.85rem;margin:0 0 1.8rem}
section{margin:0 0 2.2rem;padding-bottom:1.4rem;border-bottom:1px solid var(--line)}
h2{font-size:1rem;margin:0 0 .1rem;font-weight:600}
.ids{font:.7rem/1.6 ui-monospace,Menlo,monospace;color:var(--muted);margin-bottom:.7rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
figure{margin:0}
img{width:100%;border:1px solid var(--line);border-radius:6px;display:block;background:var(--soft)}
figcaption{font:.7rem/1.8 ui-monospace,Menlo,monospace;color:var(--muted)}
.errs{border:1px solid #F85149;border-radius:8px;padding:.7rem .9rem;margin-bottom:1.6rem;font-size:.85rem}
</style></head><body><main>
<h1>Screens · Phase 1 Registered</h1>
<p class="sub">${byStory.size} stories · ${shots.length} renders · vs_dark and vs_light at 420 px and 820 px · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>
${errors.length ? `<div class="errs"><b>${errors.length} page error(s)</b><br>${errors.map(escapeHtml).join("<br>")}</div>` : ""}
${rows}
</main></body></html>`
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

// ── run ──────────────────────────────────────────────────────────────────────────────────────────

const build = spawnSync("npm", ["run", "build-storybook", "--", "--quiet", "-o", BUILD], {
	cwd: WEBVIEW,
	stdio: "inherit",
})
if (build.status !== 0) {
	console.error("storybook build failed")
	process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const server = await serve()
const browser = await chromium.launch()
const errors = []
const shots = []

for (const story of stories()) {
	for (const theme of ["vs_dark", "vs_light"]) {
		for (const width of [420, 820]) {
			const page = await browser.newPage({
				viewport: { width, height: 900 },
				colorScheme: theme === "vs_dark" ? "dark" : "light",
				deviceScaleFactor: 2,
			})
			const label = `${story.id}/${theme}/${width}`
			page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`))
			await page.goto(`http://127.0.0.1:${PORT}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`, {
				waitUntil: "networkidle",
			})
			await page.waitForTimeout(700)
			const file = `${story.id}-${theme === "vs_dark" ? "dark" : "light"}-${width}.png`
			await page.screenshot({ path: path.join(OUT, file) })
			shots.push({ ...story, theme: theme === "vs_dark" ? "dark" : "light", width, file })
			await page.close()
		}
	}
}

await browser.close()
server.close()
writeFileSync(path.join(OUT, "index.html"), contactSheet(shots, errors))
console.log(`${shots.length} renders → ${OUT}/index.html`)
if (errors.length) {
	console.error(`PAGE ERRORS:\n${errors.join("\n")}`)
	process.exit(1)
}
