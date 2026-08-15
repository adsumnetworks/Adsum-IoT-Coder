import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { detectPinnedBoards, getBoardKnowledgeFile, platformsFromConnectedHardware } from "../iot_context"

/**
 * THE FAILURE THIS PINS (2026-08-14, from a bench session): with a Seeed XIAO nRF54LM20A plugged in
 * and an unbuilt project open, the agent repeatedly asserted the developer had an nRF54L15 DK and
 * never opened the nRF54 knowledge that had just been written.
 *
 * Two independent causes, both covered here:
 *   1. board knowledge was resolved ONLY from `build_info.yml`, which does not exist before the first
 *      build — so during setup, precisely when the board matters most, nothing was loaded and the
 *      model answered from training (where the only nRF54 board is Nordic's DK);
 *   2. the router matched `xiao_` / `xiao-` but not `XIAO ` with a space, so the connected board's
 *      USB product string routed to the DK bit — same silicon, different board, different pins.
 */
describe("iot_context — nRF board routing", () => {
	describe("getBoardKnowledgeFile — one router, every shape the name arrives in", () => {
		it("routes a XIAO from its Zephyr target, its overlay filename, and its USB product string", () => {
			const xiao = "platforms/nrf/boards/xiao-nrf54lm20a.md"
			expect(getBoardKnowledgeFile("xiao_nrf54lm20a/nrf54lm20a/cpuapp")).to.equal(xiao)
			expect(getBoardKnowledgeFile("xiao-nrf54lm20a.overlay")).to.equal(xiao)
			// The regression: spaced product string, as reported by `nrfutil device list`.
			expect(getBoardKnowledgeFile("Seeed Studio XIAO nRF54LM20A CMSIS-DAP")).to.equal(xiao)
		})

		it("does NOT give the XIAO bit to the DK carrying the same chip", () => {
			expect(getBoardKnowledgeFile("nrf54lm20dk/nrf54lm20a/cpuapp")).to.equal("platforms/nrf/boards/nrf54lm20dk.md")
		})

		it("keeps the nesting order: nrf54lm20 must not fall through to the nrf54l15 bit", () => {
			expect(getBoardKnowledgeFile("nrf54lm20dk/nrf54lm20a/cpuapp")).to.not.equal("platforms/nrf/boards/nrf54l15dk.md")
			expect(getBoardKnowledgeFile("nrf54l15dk/nrf54l15/cpuapp")).to.equal("platforms/nrf/boards/nrf54l15dk.md")
			// The L10/L05 exist only as emulation targets ON the L15 DK.
			expect(getBoardKnowledgeFile("nrf54l10dk/nrf54l10/cpuapp")).to.equal("platforms/nrf/boards/nrf54l15dk.md")
		})

		it("still routes the older families", () => {
			expect(getBoardKnowledgeFile("nrf52840dk/nrf52840")).to.equal("platforms/nrf/boards/nrf52840.md")
			expect(getBoardKnowledgeFile("nrf5340dk/nrf5340/cpuapp")).to.equal("platforms/nrf/boards/nrf5340.md")
		})

		it("returns null for a board with no knowledge yet", () => {
			expect(getBoardKnowledgeFile("nrf9160dk/nrf9160/ns")).to.be.null
		})
	})

	describe("platformsFromConnectedHardware — the prototype case", () => {
		// The session that exposed this: no folder open, so both platform detects returned false and the
		// agent got NO knowledge for the whole task — while still being handed the device tools, which it
		// used, read back "Seeed Studio XIAO nRF54LM20A CMSIS-DAP", and then ignored in favour of an
		// nRF54L15 DK from its training. Connected hardware is the only evidence a prototype has.
		it("loads nRF knowledge when a Nordic board is plugged in and no project exists", () => {
			expect(platformsFromConnectedHardware(1, 0)).to.deep.equal({ nrf: true, esp: false })
		})

		it("loads ESP knowledge when only an ESP device is plugged in", () => {
			expect(platformsFromConnectedHardware(0, 1)).to.deep.equal({ nrf: false, esp: true })
		})

		it("loads both when both are on the bench", () => {
			expect(platformsFromConnectedHardware(2, 1)).to.deep.equal({ nrf: true, esp: true })
		})

		it("loads nothing when nothing is connected — no project, no hardware, no guessing", () => {
			expect(platformsFromConnectedHardware(0, 0)).to.deep.equal({ nrf: false, esp: false })
		})
	})

	describe("detectPinnedBoards — evidence that exists BEFORE the first build", () => {
		let dir: string
		beforeEach(async () => {
			dir = await mkdtemp(path.join(tmpdir(), "nrf-board-"))
		})
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true })
		})

		it("finds the board an unbuilt project pins in boards/<board>.overlay", async () => {
			await mkdir(path.join(dir, "boards"))
			await writeFile(path.join(dir, "boards", "xiao_nrf54lm20a.overlay"), "")
			const signals = await detectPinnedBoards(dir)
			expect(signals.map((s) => s.target)).to.include("xiao_nrf54lm20a")
			expect(getBoardKnowledgeFile(signals[0].target)).to.equal("platforms/nrf/boards/xiao-nrf54lm20a.md")
		})

		it("finds a BOARD pin in CMakeLists.txt", async () => {
			await writeFile(
				path.join(dir, "CMakeLists.txt"),
				'cmake_minimum_required(VERSION 3.20)\nset(BOARD "nrf54l15dk/nrf54l15/cpuapp")\nproject(app)\n',
			)
			const signals = await detectPinnedBoards(dir)
			expect(signals.map((s) => s.target)).to.include("nrf54l15dk/nrf54l15/cpuapp")
		})

		it("names its evidence, so the agent can weigh a pin against a guess", async () => {
			await mkdir(path.join(dir, "boards"))
			await writeFile(path.join(dir, "boards", "nrf52840dk_nrf52840.conf"), "")
			const signals = await detectPinnedBoards(dir)
			expect(signals[0].origin).to.equal("boards/nrf52840dk_nrf52840.conf")
		})

		it("reports nothing for a project that pins no board", async () => {
			await writeFile(path.join(dir, "CMakeLists.txt"), "project(app)\n")
			expect(await detectPinnedBoards(dir)).to.deep.equal([])
		})
	})
})
