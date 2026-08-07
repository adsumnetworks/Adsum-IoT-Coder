import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { COMMAND_OUTPUT_FOLD_DEFAULTS, foldCommandOutput, foldCommandOutputText } from "./commandOutputFold"

/**
 * Fold of LONG COMMAND OUTPUT before it enters context. Started as an `idf.py build` fold (from 2906j: two full
 * builds + report rewrites overran the 200K window) and now guards every command: measured leaks include a
 * `west build --sysbuild` (44K chars), a `.bat` build (~43K tokens), `idf.py build` (~36K tokens) and a single
 * failed `Remove-Item` (~32K tokens of PowerShell spew).
 */
describe("commandOutputFold — foldCommandOutputText", () => {
	test("leaves output under both thresholds byte-identical", () => {
		const short = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")
		assert.equal(foldCommandOutputText(short), short)
	})

	test("leaves output at exactly the line threshold untouched", () => {
		const atLimit = Array.from({ length: COMMAND_OUTPUT_FOLD_DEFAULTS.maxLines }, (_, i) => `line ${i}`).join("\n")
		assert.equal(foldCommandOutputText(atLimit), atLimit)
	})

	test("folds a long build log to head + tail + notice, dropping the middle", () => {
		const lines = Array.from({ length: 400 }, (_, i) => `[${i}/400] Compiling foo_${i}.c`)
		lines.push("Project build complete. To flash, run: idf.py flash")
		const folded = foldCommandOutputText(lines.join("\n"))
		const out = folded.split("\n")
		assert.ok(out.length < 200, `folded should be far smaller, got ${out.length}`)
		assert.ok(folded.includes("[0/400]"), "keeps head")
		assert.ok(folded.includes("Project build complete"), "keeps the tail (build result)")
		assert.match(folded, /line\(s\) folded from the middle/, "has the inline fold marker")
		assert.match(folded, /LONG COMMAND OUTPUT FOLDED/, "always ends with the notice")
	})

	test("west build with warnings — the warnings survive the fold", () => {
		const lines = [
			"west build -b nrf52840dk/nrf52840 --sysbuild",
			...Array.from({ length: 300 }, (_, i) => `[${i}/300] Building C object zephyr/CMakeFiles/zephyr/src/mod_${i}.c.obj`),
		]
		lines.splice(150, 0, "/work/src/main.c:88:9: warning: unused variable 'ret' [-Wunused-variable]")
		lines.splice(151, 0, "/work/src/ble.c:12:1: warning: implicit declaration of function 'bt_enable'")
		lines.push("Memory region         Used Size  Region Size  %age Used")
		const folded = foldCommandOutputText(lines.join("\n"))
		assert.ok(folded.includes("unused variable 'ret'"), "mid-log warning survives")
		assert.ok(folded.includes("implicit declaration of function 'bt_enable'"), "second warning survives")
		assert.ok(folded.includes("Memory region"), "keeps the tail (size report)")
		assert.ok(!folded.includes("mod_150.c.obj"), "the compiler-noise middle is gone")
	})

	test("never folds away a failure — mid-log errors and the failing tail are preserved", () => {
		const lines = Array.from({ length: 300 }, (_, i) => `[${i}] Compiling x_${i}.c`)
		lines.splice(150, 0, "main.c:42:5: error: 'foo' undeclared (first use in this function)")
		lines.push("ninja: build stopped: subcommand failed.")
		const folded = foldCommandOutputText(lines.join("\n"))
		assert.ok(folded.includes("error: 'foo' undeclared"), "the mid-log error survives the fold")
		assert.ok(folded.includes("ninja: build stopped"), "keeps the failure tail")
	})

	test("giant PowerShell error spew is folded hard but still reads as a failure", () => {
		// A failed Remove-Item measured ~32K tokens: the same error record repeated per file.
		const spew: string[] = [
			"Remove-Item : Cannot remove item C:\\build\\zephyr\\zephyr.elf: it is being used by another process.",
		]
		for (let i = 0; i < 400; i++) {
			spew.push(
				`Remove-Item : Cannot remove item C:\\build\\obj\\file_${i}.obj: Access to the path is denied.`,
				"At line:1 char:1",
				"+ Remove-Item -Recurse -Force build",
				"+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
				"    + CategoryInfo          : WriteError: (C:\\build\\obj:DirectoryInfo) [Remove-Item], IOException",
				"    + FullyQualifiedErrorId : RemoveFileSystemItemIOError,Microsoft.PowerShell.Commands.RemoveItemCommand",
			)
		}
		const raw = spew.join("\n")
		const folded = foldCommandOutputText(raw)
		assert.ok(folded.length < raw.length / 5, `spew should shrink a lot: ${raw.length} → ${folded.length}`)
		assert.ok(folded.length <= COMMAND_OUTPUT_FOLD_DEFAULTS.maxChars + 400, "stays inside the char budget + notice")
		assert.ok(folded.includes("Cannot remove item"), "the failure is still visible")
		assert.match(folded, /LONG COMMAND OUTPUT FOLDED/, "notice present")
	})

	test("error-line overflow is announced, never silently dropped", () => {
		const lines = Array.from({ length: 400 }, (_, i) => `main.c:${i}:1: error: undeclared identifier 'sym_${i}'`)
		lines.unshift("west build -b nrf52840dk/nrf52840")
		lines.push("ninja: build stopped: subcommand failed.")
		const folded = foldCommandOutputText(lines.join("\n"))
		assert.match(folded, /and \d+ more error\/warning line\(s\) not shown/, "overflow is announced")
		const keptErrors = folded.split("\n").filter((l) => /undeclared identifier/.test(l))
		assert.ok(
			keptErrors.length >= COMMAND_OUTPUT_FOLD_DEFAULTS.maxErrorLines,
			`should keep the cap's worth of error lines, got ${keptErrors.length}`,
		)
	})

	test("folds few-but-enormous lines on the char threshold alone", () => {
		// 30 lines, well under maxLines, but 60K chars — the line fold can't help, the char clamp must.
		const fat = Array.from({ length: 30 }, (_, i) => `chunk ${i} ` + "x".repeat(2000)).join("\n")
		assert.ok(fat.length > COMMAND_OUTPUT_FOLD_DEFAULTS.maxChars * 2, "fixture really is oversized")
		const folded = foldCommandOutputText(fat)
		assert.ok(folded.length < COMMAND_OUTPUT_FOLD_DEFAULTS.maxChars + 600, `char budget held, got ${folded.length}`)
		assert.match(folded, /characters trimmed/, "the notice reports the char trim")
		assert.ok(folded.startsWith("chunk 0 "), "keeps the head")
	})

	test("names the full-output path in the notice when the caller has one", () => {
		const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")
		const folded = foldCommandOutputText(lines, { outputPath: "C:\\work\\logs\\build.log" })
		assert.ok(folded.includes("Full output: C:\\work\\logs\\build.log"), "path is named")
	})

	test("honours a custom source label and custom thresholds", () => {
		const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")
		assert.equal(foldCommandOutputText(lines), lines, "untouched at defaults")
		const folded = foldCommandOutputText(lines, {
			maxLines: 20,
			headLines: 3,
			tailLines: 5,
			source: 'the "Adsum nRF" terminal',
		})
		assert.ok(folded.includes('the "Adsum nRF" terminal'), "source named")
		assert.ok(folded.split("\n").length < 20, "custom head/tail applied")
	})
})

describe("commandOutputFold — foldCommandOutput", () => {
	test("folds a string result", () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
		assert.ok((foldCommandOutput(big) as string).length < big.length)
	})

	test("folds the text of content blocks, leaves non-text blocks intact", () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
		const res = foldCommandOutput([{ type: "text", text: big } as never, { type: "image", source: {} } as never]) as Array<{
			type: string
			text?: string
		}>
		assert.ok(res[0].text!.length < big.length, "text block folded")
		assert.equal(res[1].type, "image", "image block untouched")
	})

	test("passes a short result through unchanged", () => {
		const small = "Build succeeded."
		assert.equal(foldCommandOutput(small), small)
	})
})

describe("commandOutputFold — label option (read_file ingest caps reuse the fold)", () => {
	test("custom label appears in the notice instead of LONG COMMAND OUTPUT", () => {
		const big = Array.from({ length: 500 }, (_, i) => `[00:0${i % 10}.123] <inf> bt_hci: rx ${i}`).join("\n")
		const folded = foldCommandOutputText(big, {
			label: "LONG LOG FILE",
			maxLines: 400,
			headLines: 60,
			tailLines: 200,
			outputPath: "C:\\proj\\logs\\rtt\\device_683335182.log",
		})
		assert.ok(folded.includes("LONG LOG FILE FOLDED"), "custom label used")
		assert.ok(!folded.includes("LONG COMMAND OUTPUT"), "default label replaced")
		assert.ok(folded.includes("device_683335182.log"), "on-disk path named")
	})

	test("a giant single-read RTT log (the 333K-token class) folds to a bounded size", () => {
		// One real read_file of one RTT log measured 1.33M chars (~333K tokens) — bigger than an
		// entire 200K-token window. The log-read fold must bound it regardless of shape.
		const line = "[00:01:02.345,678] <err> gw_uart: frame CRC mismatch (len=247, seq=1042)"
		const giant = Array.from({ length: 18_000 }, () => line).join("\n")
		const folded = foldCommandOutputText(giant, { maxLines: 400, maxChars: 24_000, headLines: 60, tailLines: 200 })
		assert.ok(folded.length <= 30_000, `bounded (got ${folded.length})`)
		assert.ok(folded.includes("FOLDED"), "notice present")
	})
})
