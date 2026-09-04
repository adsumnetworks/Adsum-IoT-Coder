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
	["views-chat--entry-cold-start", "01-cold-start"],
	["views-chat--entry-first-run-with-project", "02-first-run-project"],
	["views-chat--entry-returning", "03-returning"],
	["views-chat--entry-lapsed", "04-lapsed"],
	["views-chat--entry-nothing-in-this-folder", "05-nothing-in-folder"],
	["views-chat--entry-board-detected", "06-board-detected"],
]
;(async () => {
	await new Promise((r) => server.listen(6199, r))
	const b = await chromium.launch()
	const errs = []
	for (const [id, name] of STORIES) {
		for (const [theme, cls] of [
			["dark", "dark"],
			["light", "light"],
		]) {
			for (const [w, label] of [
				[420, "sidebar"],
				[900, "editor"],
			]) {
				const p = await b.newPage({ viewport: { width: w, height: 820 }, colorScheme: theme })
				p.on("pageerror", (e) => errs.push(`${name}/${theme}/${label}: ${e.message}`))
				await p.goto(`http://127.0.0.1:6199/iframe.html?id=${id}&viewMode=story`, { waitUntil: "networkidle" })
				await p.waitForTimeout(700)
				await p.screenshot({ path: `${OUT}/${name}-${theme}-${label}.png` })
				await p.close()
			}
		}
	}
	await b.close()
	server.close()
	console.log(errs.length ? "PAGE ERRORS:\n" + errs.join("\n") : `no page errors across ${STORIES.length * 4} renders`)
})()
