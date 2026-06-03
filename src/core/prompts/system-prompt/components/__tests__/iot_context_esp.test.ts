import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { detectEspFeatures, detectEspPlatform, findEspBuilds, getEspBoardKnowledgeFile } from "../iot_context"

describe("iot_context — ESP detection", () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "esp-detect-"))
	})
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	describe("getEspBoardKnowledgeFile (target → board file)", () => {
		it("maps the supported targets", () => {
			expect(getEspBoardKnowledgeFile("esp32s3")).to.equal("platforms/esp/boards/esp32-s3.md")
			expect(getEspBoardKnowledgeFile("esp32c6")).to.equal("platforms/esp/boards/esp32-c6.md")
			expect(getEspBoardKnowledgeFile("esp32c3")).to.equal("platforms/esp/boards/esp32-c3.md")
			expect(getEspBoardKnowledgeFile("esp32")).to.equal("platforms/esp/boards/esp32-devkitc-v4.md")
		})
		it("returns null for an unknown target", () => {
			expect(getEspBoardKnowledgeFile("esp32h2")).to.be.null
		})
	})

	describe("detectEspPlatform (project gate)", () => {
		it("is true when sdkconfig is present", async () => {
			await writeFile(path.join(dir, "sdkconfig"), 'CONFIG_IDF_TARGET="esp32s3"\n')
			expect(await detectEspPlatform(dir)).to.be.true
		})
		it("is true when CMakeLists references ESP-IDF", async () => {
			await writeFile(path.join(dir, "CMakeLists.txt"), "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n")
			expect(await detectEspPlatform(dir)).to.be.true
		})
		it("is false for a non-ESP workspace", async () => {
			await writeFile(path.join(dir, "README.md"), "hello\n")
			expect(await detectEspPlatform(dir)).to.be.false
		})
	})

	describe("findEspBuilds (board from the build artifact)", () => {
		it("reads the target from build/project_description.json", async () => {
			await mkdir(path.join(dir, "build"), { recursive: true })
			await writeFile(path.join(dir, "build", "project_description.json"), JSON.stringify({ target: "esp32s3" }))
			const builds = await findEspBuilds(dir)
			expect(builds).to.have.lengthOf(1)
			expect(builds[0]).to.deep.equal({ dir: "build", target: "esp32s3" })
		})
		it("returns [] when there is no build yet", async () => {
			expect(await findEspBuilds(dir)).to.deep.equal([])
		})
	})

	describe("detectEspFeatures (config-based protocols, no hardcoding)", () => {
		it("detects BLE from CONFIG_BT_ENABLED=y", async () => {
			await writeFile(path.join(dir, "sdkconfig"), 'CONFIG_IDF_TARGET="esp32c6"\nCONFIG_BT_ENABLED=y\n')
			const f = await detectEspFeatures(dir)
			expect(f.hasBle).to.be.true
			expect(f.sdkTarget).to.equal("esp32c6")
		})
		it("does NOT flag WiFi just because esp_wifi exists — only on real usage", async () => {
			// sdkconfig with a target but no wifi enable line and no component requires
			await writeFile(path.join(dir, "sdkconfig"), 'CONFIG_IDF_TARGET="esp32"\n')
			const f = await detectEspFeatures(dir)
			expect(f.hasWifi).to.be.false
			expect(f.hasBle).to.be.false
		})
		it("detects WiFi from CONFIG_ESP_WIFI_ENABLED=y", async () => {
			await writeFile(path.join(dir, "sdkconfig"), "CONFIG_ESP_WIFI_ENABLED=y\n")
			expect((await detectEspFeatures(dir)).hasWifi).to.be.true
		})
		it("detects WiFi from a component that REQUIRES esp_wifi", async () => {
			await mkdir(path.join(dir, "main"), { recursive: true })
			await writeFile(path.join(dir, "sdkconfig"), 'CONFIG_IDF_TARGET="esp32"\n')
			await writeFile(
				path.join(dir, "main", "CMakeLists.txt"),
				'idf_component_register(SRCS "main.c" REQUIRES esp_wifi nvs_flash)\n',
			)
			expect((await detectEspFeatures(dir)).hasWifi).to.be.true
		})
	})
})
