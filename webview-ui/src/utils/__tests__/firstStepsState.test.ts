import { describe, expect, it } from "vitest"
import { firstStepsState } from "../firstStepsState"

describe("firstStepsState", () => {
	it("marks nothing done and offers the sample first, on a cold start", () => {
		const { rows, nextId } = firstStepsState({})
		expect(rows.every((r) => !r.done)).toBe(true)
		expect(nextId).toBe("sample")
	})

	it("marks the sample done from a task whose text carries the demo marker, nothing else", () => {
		const { rows, nextId } = firstStepsState({ taskHistory: [{ task: "Demo: BLE NUS\n\n[ADSUM_DEMO:nus-uart]" }] })
		expect(rows.find((r) => r.id === "sample")?.done).toBe(true)
		expect(rows.find((r) => r.id === "openProject")?.done).toBe(false)
		expect(nextId).toBe("openProject")
	})

	it("marks the project open from a non-empty openFolderPaths, regardless of history", () => {
		const { rows } = firstStepsState({ openFolderPaths: ["/Users/dev/gateway-fw"] })
		expect(rows.find((r) => r.id === "openProject")?.done).toBe(true)
	})

	it("marks build done from a task mentioning build or flash", () => {
		expect(
			firstStepsState({ taskHistory: [{ task: "flash the connected board" }] }).rows.find((r) => r.id === "build")?.done,
		).toBe(true)
		expect(
			firstStepsState({ taskHistory: [{ task: "Build this project and run it" }] }).rows.find((r) => r.id === "build")
				?.done,
		).toBe(true)
		expect(firstStepsState({ taskHistory: [{ task: "rebuild the index" }] }).rows.find((r) => r.id === "build")?.done).toBe(
			false,
		)
	})

	it("marks registered from the presence of an account, truthy or not signed in yet", () => {
		expect(firstStepsState({ adsumAccount: null }).rows.find((r) => r.id === "register")?.done).toBe(false)
		expect(
			firstStepsState({
				adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups: [], openRequests: [] },
			}).rows.find((r) => r.id === "register")?.done,
		).toBe(true)
	})

	it("marks gateway done from a task mentioning BLG20x or LEW840x, case-insensitively", () => {
		expect(
			firstStepsState({ taskHistory: [{ task: "Start the BLG20x first run" }] }).rows.find((r) => r.id === "gateway")?.done,
		).toBe(true)
		expect(
			firstStepsState({ taskHistory: [{ task: "commission the lew840x" }] }).rows.find((r) => r.id === "gateway")?.done,
		).toBe(true)
		expect(firstStepsState({ taskHistory: [{ task: "set up a gateway" }] }).rows.find((r) => r.id === "gateway")?.done).toBe(
			false,
		)
	})

	it("offers no next row once every row is done", () => {
		const { nextId } = firstStepsState({
			taskHistory: [{ task: "[ADSUM_DEMO:nus-uart]" }, { task: "flash it" }, { task: "blg20x" }],
			openFolderPaths: ["/Users/dev/fw"],
			adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups: [], openRequests: [] },
		})
		expect(nextId).toBeNull()
	})

	it("always offers the ladder in the same fixed order", () => {
		const { rows } = firstStepsState({})
		expect(rows.map((r) => r.id)).toEqual(["sample", "openProject", "build", "register", "gateway"])
	})
})
