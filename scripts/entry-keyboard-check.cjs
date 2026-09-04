const { chromium } = require("@playwright/test")
const http = require("http"),
	fs = require("fs"),
	path = require("path"),
	url = require("url")
const ROOT = process.argv[2]
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
const fails = []
const check = (name, ok, detail) => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " — " + detail}`)
	if (!ok) fails.push(name)
}

const focused = (p) =>
	p.evaluate(() => {
		const a = document.activeElement
		if (!a) return "none"
		return (
			a.getAttribute("data-testid") ||
			a.tagName.toLowerCase() + (a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : "")
		)
	})

;(async () => {
	await new Promise((r) => server.listen(6198, r))
	const b = await chromium.launch()
	const open = async (id) => {
		const p = await b.newPage({ viewport: { width: 420, height: 820 } })
		await p.goto(`http://127.0.0.1:6198/iframe.html?id=${id}&viewMode=story`, { waitUntil: "networkidle" })
		await p.waitForTimeout(600)
		return p
	}

	console.log("keyboard reach — returning state")
	let p = await open("views-chat--entry-returning")
	// The composer holds focus on open — that is the promise: type and you are in a new session.
	check("the composer has focus when the surface opens", (await focused(p)) === "chat-input", await focused(p))
	// So the surface's own controls sit BEHIND it: Shift+Tab is the way back up, which is where a
	// keyboard user looks for something rendered above the box.
	const back = []
	for (let i = 0; i < 8; i++) {
		await p.keyboard.press("Shift+Tab")
		back.push(await focused(p))
	}
	console.log("    shift-tab order:", back.join(" → "))
	check("the resume is reachable going back from the input", back.includes("entry-resume"), back.join(" → "))
	check("the drawer button is reachable going back from the input", back.includes("entry-burger"), back.join(" → "))
	await p.close()

	console.log("drawer — focus and escape")
	p = await open("views-chat--entry-returning")
	await p.click('[data-testid="entry-burger"]')
	await p.waitForTimeout(300)
	check("opening the drawer puts focus in its filter", (await focused(p)) === "entry-drawer-filter", await focused(p))
	// Tab through the whole drawer twice: focus must never land outside it.
	let escaped = null
	for (let i = 0; i < 25; i++) {
		await p.keyboard.press("Tab")
		const inside = await p.evaluate(() => {
			const d = document.querySelector('[data-testid="entry-drawer"]')
			return !!(d && document.activeElement && d.contains(document.activeElement))
		})
		if (!inside) {
			escaped = await focused(p)
			break
		}
	}
	check("focus stays inside the open drawer", escaped === null, `escaped to ${escaped}`)
	await p.keyboard.press("Escape")
	await p.waitForTimeout(250)
	check("Escape closes the drawer", (await p.locator('[data-testid="entry-drawer"]').count()) === 0, "still open")
	await p.close()

	console.log("contrast — the reason line, both themes")
	for (const theme of ["dark", "light"]) {
		const pg = await b.newPage({ viewport: { width: 420, height: 820 }, colorScheme: theme })
		await pg.goto(`http://127.0.0.1:6198/iframe.html?id=views-chat--entry-board-detected&viewMode=story`, {
			waitUntil: "networkidle",
		})
		await pg.waitForTimeout(600)
		const r = await pg.evaluate(() => {
			const lum = (c) => {
				const [r, g, b] = c
					.match(/\d+/g)
					.map(Number)
					.map((v) => {
						v /= 255
						return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
					})
				return 0.2126 * r + 0.7152 * g + 0.0722 * b
			}
			const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /◆/.test(e.textContent || ""))
			if (!el) return null
			const fg = getComputedStyle(el).color
			let bgEl = el,
				bg = "rgba(0, 0, 0, 0)"
			while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
				bg = getComputedStyle(bgEl).backgroundColor
				bgEl = bgEl.parentElement
			}
			const L1 = lum(fg),
				L2 = lum(bg)
			return { fg, bg, ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) }
		})
		if (!r) {
			check(`${theme}: reason line found`, false, "no ◆ element")
			continue
		}
		check(`${theme}: reason line contrast ≥ 4.5:1`, r.ratio >= 4.5, `${r.ratio.toFixed(2)}:1  fg=${r.fg} bg=${r.bg}`)
		await pg.close()
	}

	await b.close()
	server.close()
	console.log(fails.length ? `\n${fails.length} FAILED` : "\nall keyboard and contrast checks passed")
	process.exit(fails.length ? 1 : 0)
})()
