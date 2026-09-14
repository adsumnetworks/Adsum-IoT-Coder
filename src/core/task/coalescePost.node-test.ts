/**
 * B31b, 14 Sep — with the editor window hidden, every task step waited up to a minute on a state post.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/core/task/coalescePost.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { coalescePost } from "./coalescePost"

const never = () => new Promise<void>(() => {})

describe("B31b — the task path never waits on the panel", () => {
	test("P-1 a state post that never resolves does not hold up the caller", { timeout: 3000 }, async () => {
		let calls = 0
		const post = coalescePost(() => {
			calls++
			return never()
		})
		const started = Date.now()
		for (let i = 0; i < 20; i++) {
			await post()
		}
		assert.ok(Date.now() - started < 100, "the caller waited on the panel")
		assert.equal(calls, 1, "calls made while one post was in flight must collapse into one trailing post")
	})

	test("P-2 posts made while one is in flight collapse into exactly one trailing post", async () => {
		const releases: Array<() => void> = []
		let calls = 0
		const post = coalescePost(() => {
			calls++
			return new Promise<void>((r) => releases.push(r))
		})
		await post()
		await post()
		await post()
		await post()
		assert.equal(calls, 1)
		releases.shift()?.()
		await sleep(10)
		assert.equal(calls, 2, "one trailing post after the first one settles")
		releases.shift()?.()
		await sleep(10)
		assert.equal(calls, 2, "no further posts without a new request")
	})

	test("P-3 a failing post is reported and does not wedge later posts", async () => {
		const errors: unknown[] = []
		let calls = 0
		const post = coalescePost(
			() => {
				calls++
				return calls === 1 ? Promise.reject(new Error("panel gone")) : Promise.resolve()
			},
			(e) => errors.push(e),
		)
		await post()
		await sleep(10)
		await post()
		await sleep(10)
		assert.equal(errors.length, 1)
		assert.equal(calls, 2)
	})

	test("P-4 the task wires every state post through the coalescer", () => {
		const src = readFileSync(join(__dirname, "index.ts"), "utf8")
		assert.match(src, /this\.postStateToWebview = coalescePost\(/, "Task must wrap the controller's state post")
	})
})
