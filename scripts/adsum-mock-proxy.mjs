#!/usr/bin/env node
/**
 * Adsum Free-Tier Mock Proxy
 *
 * Implements the adsum-backend contract locally so the adsum-free provider
 * can be tested end-to-end without a deployed backend.
 *
 * Usage:
 *   node scripts/adsum-mock-proxy.mjs [--quota 50000] [--exhaust]
 *
 * Options:
 *   --quota <n>   Token quota for the mock install (default: 50000)
 *   --exhaust     Start with quota already exhausted (tests 402 flow)
 *   --port <n>    Port to listen on (default: 7788)
 *
 * Set CLINE_ENVIRONMENT=local in your launch config so the extension
 * points at http://localhost:7788 (ClineEnv.config().adsumApiBaseUrl).
 *
 * Requires: Node 18+ (built-in fetch / http). No npm install needed.
 */

import http from "node:http"

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const PORT = Number(args[args.indexOf("--port") + 1] || 7788)
const QUOTA = Number(args[args.indexOf("--quota") + 1] || 50_000)
const START_EXHAUSTED = args.includes("--exhaust")

// Upstream: DeepSeek (or any OpenAI-compatible endpoint for mock testing)
// Set DEEPSEEK_API_KEY env var to forward to real DeepSeek, otherwise
// the mock returns a canned response (no external call needed).
const UPSTREAM_BASE = "https://api.deepseek.com/v1"
const UPSTREAM_KEY = process.env.DEEPSEEK_API_KEY

// ── State (in-memory, resets on restart) ─────────────────────────────────────

const accounts = new Map() // install_id → { tokensUsed, quota }

function getAccount(installId) {
	if (!accounts.has(installId)) {
		accounts.set(installId, {
			tokensUsed: START_EXHAUSTED ? QUOTA : 0,
			quota: QUOTA,
		})
	}
	return accounts.get(installId)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, status, body, extraHeaders = {}) {
	const payload = JSON.stringify(body)
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		...extraHeaders,
	})
	res.end(payload)
}

function getInstallId(req) {
	// Accept either Authorization: Bearer <install_id> or X-Install-ID header
	const auth = req.headers["authorization"]
	if (auth?.startsWith("Bearer ")) {
		return auth.slice(7)
	}
	return req.headers["x-install-id"] || null
}

async function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = ""
		req.on("data", (chunk) => {
			data += chunk
		})
		req.on("end", () => {
			try {
				resolve(JSON.parse(data || "{}"))
			} catch {
				resolve({})
			}
		})
		req.on("error", reject)
	})
}

/** Canned streaming response for when no DEEPSEEK_API_KEY is set */
function cannedStream(res, installId, account) {
	const content =
		"[MOCK] This is a canned response from the Adsum mock proxy.\n\n" +
		"Set DEEPSEEK_API_KEY env var to forward to real DeepSeek.\n\n" +
		`Install ID: ${installId}\n` +
		`Tokens used: ${account.tokensUsed} / ${account.quota}`

	const promptTokens = 100
	const completionTokens = 50
	account.tokensUsed += promptTokens + completionTokens
	const remaining = Math.max(0, account.quota - account.tokensUsed)

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"X-Free-Quota-Remaining": String(remaining),
	})

	// Stream content in chunks
	const words = content.split(" ")
	let i = 0
	const interval = setInterval(() => {
		if (i < words.length) {
			const chunk = {
				id: "mock-gen-id",
				object: "chat.completion.chunk",
				choices: [{ delta: { content: (i > 0 ? " " : "") + words[i] }, index: 0 }],
			}
			res.write(`data: ${JSON.stringify(chunk)}\n\n`)
			i++
		} else {
			// Final usage chunk
			const usageChunk = {
				id: "mock-gen-id",
				object: "chat.completion.chunk",
				choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: promptTokens + completionTokens,
				},
			}
			res.write(`data: ${JSON.stringify(usageChunk)}\n\n`)
			res.write("data: [DONE]\n\n")
			clearInterval(interval)
			res.end()
		}
	}, 30)
}

/** Forward request to real DeepSeek and pipe the stream back */
async function forwardToDeepSeek(_req, res, body, installId, account) {
	const upstream = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${UPSTREAM_KEY}`,
		},
		body: JSON.stringify({ ...body, model: "deepseek-chat", stream: true, stream_options: { include_usage: true } }),
	})

	if (!upstream.ok) {
		const err = await upstream.text()
		console.error("[mock] DeepSeek error:", upstream.status, err)
		return json(res, upstream.status, { error: err })
	}

	// Pipe the stream back, tracking token usage as we go
	let promptTokens = 0
	let completionTokens = 0

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		// Header updated after stream ends; we send a placeholder now
		"X-Free-Quota-Remaining": String(Math.max(0, account.quota - account.tokensUsed)),
	})

	const reader = upstream.body.getReader()
	const decoder = new TextDecoder()

	while (true) {
		const { done, value } = await reader.read()
		if (done) {
			break
		}
		const text = decoder.decode(value, { stream: true })

		// Parse usage from SSE lines
		for (const line of text.split("\n")) {
			if (line.startsWith("data: ") && !line.includes("[DONE]")) {
				try {
					const chunk = JSON.parse(line.slice(6))
					if (chunk.usage) {
						promptTokens = chunk.usage.prompt_tokens || 0
						completionTokens = chunk.usage.completion_tokens || 0
					}
				} catch {
					// ignore parse errors in stream
				}
			}
		}

		res.write(text)
	}

	// Update quota after stream completes
	account.tokensUsed += promptTokens + completionTokens
	console.log(
		`[mock] ${installId} used ${promptTokens + completionTokens} tokens. ` + `Total: ${account.tokensUsed}/${account.quota}`,
	)
	res.end()
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(req, res) {
	const url = new URL(req.url, `http://localhost:${PORT}`)
	console.log(`[mock] ${req.method} ${url.pathname}`)

	// CORS for webview
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Install-ID, X-Task-ID")
	if (req.method === "OPTIONS") {
		res.writeHead(204)
		res.end()
		return
	}

	// POST /v1/register-install
	if (req.method === "POST" && url.pathname === "/v1/register-install") {
		const body = await readBody(req)
		const installId = body.install_id || getInstallId(req)
		if (!installId) {
			return json(res, 400, { error: "install_id required" })
		}

		const account = getAccount(installId)
		console.log(`[mock] Registered install: ${installId} (quota: ${account.quota})`)
		return json(res, 200, { install_id: installId, quota: account.quota, tokens_used: account.tokensUsed })
	}

	// POST /v1/chat/completions
	if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
		const installId = getInstallId(req)
		if (!installId) {
			return json(res, 401, { error: "Missing install_id in Authorization or X-Install-ID header" })
		}

		const account = getAccount(installId)

		// 402 — quota exhausted
		if (account.tokensUsed >= account.quota) {
			console.log(`[mock] 402 quota exhausted for ${installId}`)
			return json(
				res,
				402,
				{ reason: "quota_exhausted", remaining: 0, next: ["verify_email", "add_byok"] },
				{ "X-Free-Quota-Remaining": "0" },
			)
		}

		const body = await readBody(req)

		if (UPSTREAM_KEY) {
			return forwardToDeepSeek(req, res, body, installId, account)
		} else {
			return cannedStream(res, installId, account)
		}
	}

	// Health check
	if (req.method === "GET" && url.pathname === "/health") {
		return json(res, 200, { status: "ok", accounts: accounts.size })
	}

	return json(res, 404, { error: "Not found" })
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
	try {
		await handleRequest(req, res)
	} catch (err) {
		console.error("[mock] Unhandled error:", err)
		if (!res.headersSent) {
			json(res, 500, { error: String(err) })
		}
	}
})

server.listen(PORT, () => {
	console.log(`\n✅ Adsum mock proxy running on http://localhost:${PORT}`)
	console.log(`   Token quota per install: ${QUOTA.toLocaleString()}`)
	console.log(`   Start exhausted:         ${START_EXHAUSTED}`)
	console.log(`   DeepSeek forwarding:     ${UPSTREAM_KEY ? "enabled (set DEEPSEEK_API_KEY)" : "disabled (canned responses)"}`)
	console.log(`\n   Set in VS Code launch.json:`)
	console.log(`     "CLINE_ENVIRONMENT": "local"`)
	console.log(`\n   Test 402 flow:`)
	console.log(`     node scripts/adsum-mock-proxy.mjs --exhaust\n`)
})
