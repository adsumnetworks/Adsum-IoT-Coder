import { describe, it } from "mocha"
import "should"
import { join } from "path"
import { classifyWorkspace, type FsAdapter } from "../WorkspaceClassifier"

// ---------------------------------------------------------------------------
// Fixture builder — builds an in-memory FsAdapter from a map of path→content.
// Directories are inferred from the presence of files inside them.
// ---------------------------------------------------------------------------
function fixture(files: Record<string, string>): FsAdapter {
	// Build the directory set from file paths
	const dirs = new Set<string>()
	for (const filePath of Object.keys(files)) {
		let p = filePath
		while (true) {
			const parent = p.split("/").slice(0, -1).join("/")
			if (!parent || parent === p) break
			dirs.add(parent)
			p = parent
		}
	}

	const exists = (p: string) => p in files || dirs.has(p)
	const readFile = (p: string) => files[p] ?? ""
	const isDir = (p: string) => dirs.has(p)
	const listDir = (dir: string) => {
		const entries = new Set<string>()
		const prefix = dir + "/"
		for (const p of [...Object.keys(files), ...Array.from(dirs)]) {
			if (p.startsWith(prefix)) {
				const rest = p.slice(prefix.length)
				const seg = rest.split("/")[0]
				if (seg) entries.add(seg)
			}
		}
		return Array.from(entries)
	}

	return { exists, readFile, listDir, isDir }
}

const NRF_CMAKE = `cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(my_app)`

const ESP_CMAKE = `cmake_minimum_required(VERSION 3.20)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(my_app)`

const MIXED_CMAKE = `cmake_minimum_required(VERSION 3.20)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(mixed)`

const PLAIN_CMAKE = `cmake_minimum_required(VERSION 3.20)
project(generic_c_project)
add_executable(app main.c)`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkspaceClassifier", () => {
	describe("NRF detection", () => {
		it("detects nRF from CMakeLists find_package(Zephyr (definitive)", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("nrf")
			result.apps.should.have.length(1)
			result.apps[0].platform.should.equal("nrf")
			result.apps[0].confidence.should.equal("definitive")
		})

		it("detects nRF from 2 supporting files (prj.conf + west.yml) — fresh clone before build", () => {
			const fs = fixture({ "/proj/prj.conf": "", "/proj/west.yml": "manifest:\n  remotes:\n    - name: nrfconnect" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("nrf")
			result.apps[0].confidence.should.equal("supporting")
		})

		it("detects nRF from build artifact build_info.yml inside build/", () => {
			const fs = fixture({
				"/proj/build/zephyr/build_info.yml": "cmake_version: 3.0.0",
			})
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("nrf")
			result.apps[0].confidence.should.equal("definitive")
		})

		it("detects nRF from ncs_version.h nested in build/zephyr/include/generated/", () => {
			const fs = fixture({
				"/proj/CMakeLists.txt": NRF_CMAKE,
				"/proj/build/zephyr/include/generated/ncs_version.h": '#define NCS_VERSION_STRING "3.2.1"',
			})
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("nrf")
			result.apps[0].confidence.should.equal("definitive")
		})

		it("single supporting file is NOT enough", () => {
			const fs = fixture({ "/proj/prj.conf": "" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("none")
		})
	})

	describe("ESP detection", () => {
		it("detects ESP from CMakeLists include(IDF_PATH/tools/cmake/project.cmake) (definitive)", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": ESP_CMAKE })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("esp")
			result.apps[0].platform.should.equal("esp")
			result.apps[0].confidence.should.equal("definitive")
		})

		it("detects ESP from build/project_description.json (definitive)", () => {
			const fs = fixture({ "/proj/build/project_description.json": '{"idf_version":"v5.3.2"}' })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("esp")
			result.apps[0].confidence.should.equal("definitive")
		})

		it("detects ESP from build/flasher_args.json (definitive)", () => {
			const fs = fixture({ "/proj/build/flasher_args.json": "{}" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("esp")
		})

		it("detects ESP from 2 supporting files (sdkconfig + sdkconfig.defaults)", () => {
			const fs = fixture({ "/proj/sdkconfig": "", "/proj/sdkconfig.defaults": "" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("esp")
			result.apps[0].confidence.should.equal("supporting")
		})

		it("detects ESP from sdkconfig + main/CMakeLists.txt (idf project structure)", () => {
			const fs = fixture({ "/proj/sdkconfig": "", "/proj/main/CMakeLists.txt": "idf_component_register(SRCS main.c)" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("esp")
		})
	})

	describe("none case", () => {
		it("returns none for empty workspace", () => {
			const fs = fixture({})
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("none")
			result.apps.should.have.length(0)
		})

		it("returns none for plain CMakeLists with no Zephyr or IDF", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": PLAIN_CMAKE })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("none")
		})

		it("returns none for 1 nRF supporting file + 1 ESP supporting file", () => {
			const fs = fixture({ "/proj/prj.conf": "", "/proj/sdkconfig": "" })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("none")
		})
	})

	describe("both (mixed workspace)", () => {
		it("detects BOTH from a single folder with mixed cmake", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": MIXED_CMAKE })
			const result = classifyWorkspace(["/proj"], fs)
			result.summary.should.equal("both")
			result.apps.should.have.length(2)
			result.apps.map((a) => a.platform).should.containEql("nrf")
			result.apps.map((a) => a.platform).should.containEql("esp")
		})

		it("detects BOTH from separate nRF and ESP app folders at depth 1", () => {
			const fs = fixture({
				"/workspace/nrf-app/CMakeLists.txt": NRF_CMAKE,
				"/workspace/esp-app/CMakeLists.txt": ESP_CMAKE,
			})
			const result = classifyWorkspace(["/workspace"], fs)
			result.summary.should.equal("both")
			const paths = result.apps.map((a) => a.path)
			paths.should.containEql(join("/workspace", "nrf-app"))
			paths.should.containEql(join("/workspace", "esp-app"))
		})

		it("detects BOTH from nested apps at depth 2", () => {
			const fs = fixture({
				"/ws/firmware/nrf-sensor/CMakeLists.txt": NRF_CMAKE,
				"/ws/firmware/esp-gateway/CMakeLists.txt": ESP_CMAKE,
			})
			const result = classifyWorkspace(["/ws"], fs)
			result.summary.should.equal("both")
		})
	})

	describe("scan boundaries", () => {
		it("does NOT descend into build/ subdirectories when scanning app roots", () => {
			// The build/ folder has a nested app CMakeLists — should NOT be counted as an app root
			const fs = fixture({
				"/proj/build/app/CMakeLists.txt": NRF_CMAKE,
				"/proj/prj.conf": "",
				"/proj/west.yml": "",
			})
			const result = classifyWorkspace(["/proj"], fs)
			// Only one app entry — the root, not the build sub-app
			result.apps.filter((a) => a.path === "/proj").should.have.length(1)
			result.apps.filter((a) => a.path.includes("build")).should.have.length(0)
		})

		it("does NOT descend into node_modules", () => {
			const fs = fixture({ "/ws/node_modules/some-pkg/CMakeLists.txt": NRF_CMAKE })
			const result = classifyWorkspace(["/ws"], fs)
			result.summary.should.equal("none")
		})

		it("does NOT descend past depth 2", () => {
			const fs = fixture({ "/ws/a/b/c/CMakeLists.txt": NRF_CMAKE })
			const result = classifyWorkspace(["/ws"], fs)
			// depth 3 is out of range — should not be found
			result.summary.should.equal("none")
		})

		it("scans depth 2 sub-app correctly", () => {
			const fs = fixture({ "/ws/apps/nrf-blinky/CMakeLists.txt": NRF_CMAKE })
			const result = classifyWorkspace(["/ws"], fs)
			result.summary.should.equal("nrf")
		})

		it("deduplicates if same folder is visited multiple times", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE })
			// Pass the same root twice
			const result = classifyWorkspace(["/proj", "/proj"], fs)
			result.apps.should.have.length(1)
		})
	})

	describe("multi-root workspace", () => {
		it("combines results from multiple roots", () => {
			const fs = fixture({
				"/nrf-root/CMakeLists.txt": NRF_CMAKE,
				"/esp-root/CMakeLists.txt": ESP_CMAKE,
			})
			const result = classifyWorkspace(["/nrf-root", "/esp-root"], fs)
			result.summary.should.equal("both")
		})
	})

	// -----------------------------------------------------------------------
	// Workspace features (A3/A10) — BLE + compliance file-presence signals.
	// These accumulate independently of platform classification.
	// -----------------------------------------------------------------------
	describe("features.hasBle", () => {
		it("detects BLE from nRF prj.conf CONFIG_BT=y", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/prj.conf": "CONFIG_BT=y\nCONFIG_LOG=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(true)
		})

		it("detects BLE from ESP sdkconfig CONFIG_BT_ENABLED=y", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": ESP_CMAKE, "/proj/sdkconfig": "CONFIG_BT_ENABLED=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(true)
		})

		it("detects BLE from sdkconfig.defaults too", () => {
			const fs = fixture({ "/proj/sdkconfig": "", "/proj/sdkconfig.defaults": "CONFIG_BT_ENABLED=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(true)
		})

		it("tolerates whitespace around the assignment", () => {
			const fs = fixture({ "/proj/prj.conf": "  CONFIG_BT = y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(true)
		})

		it("does NOT flag BLE for CONFIG_BT=n", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/prj.conf": "CONFIG_BT=n\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(false)
		})

		it("does NOT flag BLE for a CONFIG_BT_* symbol without the master switch", () => {
			// Keys on the master switch CONFIG_BT=y, not CONFIG_BT_PERIPHERAL etc. (conservative: a miss only hides the sub-line).
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/prj.conf": "CONFIG_BT_PERIPHERAL=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(false)
		})

		it("hasBle false when no config enables a BLE stack", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/prj.conf": "CONFIG_LOG=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasBle.should.equal(false)
		})
	})

	describe("features.hasComplianceArtifacts", () => {
		it("detects a top-level compliance/ directory", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/compliance/sbom/app.spdx.json": "{}" })
			classifyWorkspace(["/proj"], fs).features.hasComplianceArtifacts.should.equal(true)
		})

		it("detects compliance/ in a depth-1 app folder", () => {
			const fs = fixture({ "/ws/app/CMakeLists.txt": NRF_CMAKE, "/ws/app/compliance/cra-remediation.md": "# notes" })
			classifyWorkspace(["/ws"], fs).features.hasComplianceArtifacts.should.equal(true)
		})

		it("hasComplianceArtifacts false with no compliance/ dir", () => {
			const fs = fixture({ "/proj/CMakeLists.txt": NRF_CMAKE, "/proj/prj.conf": "CONFIG_BT=y\n" })
			classifyWorkspace(["/proj"], fs).features.hasComplianceArtifacts.should.equal(false)
		})
	})

	describe("features default", () => {
		it("empty workspace → both feature flags false", () => {
			const f = classifyWorkspace(["/proj"], fixture({})).features
			f.hasBle.should.equal(false)
			f.hasComplianceArtifacts.should.equal(false)
		})
	})
})
