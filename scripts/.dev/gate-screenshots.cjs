/**
 * Contact sheet for the register gate — the real components, not a re-drawing of them.
 *
 *   npm --prefix webview-ui run build-storybook -- --quiet -o /tmp/sb-out
 *   node scripts/.dev/gate-screenshots.cjs /tmp/sb-out <out-dir>
 *
 * Every story is rendered in both themes at sidebar and editor width, because the two bugs this
 * surface actually has are a colour defined for one theme only and a short string meeting a narrow
 * column. Page errors are collected and printed: a story that throws must never pass as a screenshot
 * of a working screen.
 */
const { chromium } = require("@playwright/test")
const http = require("http"),
	fs = require("fs"),
	path = require("path"),
	url = require("url")

const ROOT = process.argv[2],
	OUT = process.argv[3]
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
const server = http.createServer((req, res) => {
	let p = path.join(ROOT, decodeURIComponent(url.parse(req.url).pathname))
	if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html")
	if (!fs.existsSync(p)) {
		res.writeHead(404)
		return res.end("no")
	}
	res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" })
	fs.createReadStream(p).pipe(res)
})

const STORIES = [
	["views-chat--entry-cellular-locked", "01-welcome-anonymous"],
	["views-chat--entry-cellular-board-hint", "02-welcome-board-hint"],
	["views-chat--entry-gate-open", "03-gate-open"],
	["views-chat--entry-cellular-unlocked", "05-cellular-unlocked"],
	["adsum-gatepanel--default", "03b-gate-default"],
	["adsum-gatepanel--offline", "10a-gate-offline"],
	["adsum-gatepanel--verify-pending", "10b-gate-verify"],
]

;(async () => {
	fs.mkdirSync(OUT, { recursive: true })
	await new Promise((r) => server.listen(6198, r))
	const b = await chromium.launch()
	const errs = []
	for (const [id, name] of STORIES) {
		for (const theme of ["dark", "light"]) {
			for (const [w, label] of [
				[420, "sidebar"],
				[900, "editor"],
			]) {
				// The theme is a Storybook GLOBAL, not the browser's colour-scheme preference: the webview
				// paints from --vscode-* variables the preview decorator sets. colorScheme alone renders
				// dark twice and files one of them as "light", which is worse than not checking at all.
				const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 })
				p.on("pageerror", (e) => errs.push(`${name}/${theme}/${label}: ${e.message}`))
				await p.goto(
					`http://127.0.0.1:6198/iframe.html?id=${id}&viewMode=story&globals=theme:${theme === "dark" ? "vs_dark" : "vs_light"}`,
					{
						waitUntil: "networkidle",
					},
				)
				await p.waitForTimeout(800)
				await p.screenshot({ path: `${OUT}/${name}-${theme}-${label}.png` })
				await p.close()
			}
		}
	}
	await b.close()
	server.close()
	console.log(errs.length ? "PAGE ERRORS:\n" + errs.join("\n") : `no page errors across ${STORIES.length * 4} renders`)
})()
