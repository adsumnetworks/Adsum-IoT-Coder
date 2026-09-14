/**
 * B21, 14 Sep — a task froze twice on the bench: once before the first token (7+ minutes), once mid-reasoning,
 * and the next task then sat at zero messages until the host restarted.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/core/api/turnStall.node-test.ts
 */
import { strict as assert } from "node:assert"
import { describe, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { deliverToWebview } from "@/hosts/vscode/deliverToWebview"
import { OpenRouterHandler } from "./providers/openrouter"
import { autoRetryLimitFor, guardStream, StreamStalledError, startTurnWatchdog } from "./stream-watchdog"

const never = <T>() => new Promise<T>(() => {})

describe("B21 — a panel in the background cannot freeze a task", () => {
	test(
		"S-1 a message to a panel that never acknowledges does not hold up its sender, and order is kept",
		{ timeout: 6000 },
		async () => {
			const seen: string[] = []
			const panel = { postMessage: (m: unknown) => (seen.push(String(m)), never<boolean>()) }
			const started = Date.now()
			await deliverToWebview(panel, "say:reasoning")
			await deliverToWebview(panel, "state")
			await deliverToWebview(panel, "say:api_req_started")
			assert.ok(Date.now() - started < 100, "delivery was awaited")
			assert.deepEqual(seen, ["say:reasoning", "state", "say:api_req_started"])
		},
	)

	test("S-2 a failed delivery is reported, never thrown into the task", async () => {
		const errors: unknown[] = []
		const panel = { postMessage: () => Promise.reject(new Error("webview disposed")) }
		assert.equal(await deliverToWebview(panel, "x", (e) => errors.push(e)), true)
		await sleep(0)
		assert.equal(errors.length, 1)
	})

	test(
		"S-3 the next task reaches api_req_started within 5 s while the last one's panel never acknowledged",
		{ timeout: 6000 },
		async () => {
			// The frozen shape: task 1's say() waits on delivery; task 2's start posts state, then its api_req_started.
			const posted: string[] = []
			const panel = { postMessage: (m: unknown) => (posted.push(String(m)), never<boolean>()) }
			const say = (text: string) => deliverToWebview(panel, text)
			void say("task1:reasoning") // the turn that stalled
			const t0 = Date.now()
			const task2 = (async () => {
				await say("task2:state")
				await say("task2:api_req_started")
			})()
			await Promise.race([task2, sleep(5000).then(() => assert.fail("task 2 did not reach api_req_started in 5 s"))])
			assert.ok(Date.now() - t0 < 5000)
			assert.deepEqual(posted, ["task1:reasoning", "task2:state", "task2:api_req_started"])
		},
	)
})

describe("B21 — a stall is timed out, retried once, then shown", () => {
	test("T-1 no first token: the stream times out", async () => {
		const inner = { next: () => never<IteratorResult<string>>() }
		let aborted = 0
		const g = guardStream(inner as AsyncIterator<string>, { firstChunkMs: 30, idleMs: 30, abort: () => aborted++ })
		await assert.rejects(
			() => g.next(),
			(e: unknown) => e instanceof StreamStalledError && e.beforeFirstChunk,
		)
		assert.equal(aborted, 1)
	})

	test("T-2 stalled while handling a reasoning chunk: the turn watchdog fires though next() was never called again", async () => {
		const stalls: StreamStalledError[] = []
		const w = startTurnWatchdog({
			idleMs: 60,
			checkEveryMs: 10,
			isWaitingForUser: () => false,
			onStall: (e) => stalls.push(e),
		})
		w.touch() // a reasoning chunk arrived; its handling then never returns
		await sleep(150)
		w.stop()
		assert.equal(stalls.length, 1)
		assert.ok(w.stalled instanceof StreamStalledError)
	})

	test("T-3 a turn waiting on the developer is never timed out", async () => {
		const stalls: unknown[] = []
		const w = startTurnWatchdog({
			idleMs: 40,
			checkEveryMs: 10,
			isWaitingForUser: () => true,
			onStall: (e) => stalls.push(e),
		})
		await sleep(120)
		w.stop()
		assert.equal(stalls.length, 0)
	})

	test("T-4 a stall is retried once, then shown; other failures keep their three retries", () => {
		assert.equal(autoRetryLimitFor(new StreamStalledError(90_000, false)), 1)
		assert.equal(autoRetryLimitFor(new StreamStalledError(120_000, true)), 1)
		assert.equal(autoRetryLimitFor(new Error("429 rate limited")), 3)
	})

	test("T-5 OpenRouter's abort cancels the HTTP request itself", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "k",
			openRouterModelId: "deepseek/deepseek-v4-flash-0731",
		} as never)
		// The model lookup reads the editor's cached catalogue; this test is about the request, not the catalogue.
		;(handler as unknown as { getModel: () => unknown }).getModel = () => ({
			id: "deepseek/deepseek-v4-flash-0731",
			info: { maxTokens: 8192, contextWindow: 128000, supportsImages: false, supportsPromptCache: false },
		})
		let signal: AbortSignal | undefined
		;(handler as unknown as { client: unknown }).client = {
			chat: {
				completions: {
					create: async (_body: unknown, opts?: { signal?: AbortSignal }) => {
						signal = opts?.signal
						return (async function* () {
							await never()
						})()
					},
				},
			},
		}
		const it = handler.createMessage("sys", [{ role: "user", content: "hi" }] as never)[Symbol.asyncIterator]()
		void it.next().catch(() => {})
		await sleep(20)
		assert.ok(signal, "the request was made with an abort signal")
		assert.equal(typeof handler.abort, "function")
		handler.abort?.()
		assert.equal(signal?.aborted, true)
	})
})
