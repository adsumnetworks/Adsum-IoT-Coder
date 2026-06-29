/**
 * Build-evidence readers (CVE scan loop — design/15 §6). Gather the two host facts the applicability engine
 * needs from a *verified* build dir: the merged Kconfig (`.config` / `sdkconfig`) and the ELF symbol dump
 * (`nm`). fs + `nm` are injected so the path resolution stays unit-testable without a real build.
 *
 * Risk mitigations:
 *  - **Wrong toolchain `nm`** (plain `nm` can't read an ARM ELF / yields nothing): a failed/empty dump returns
 *    `undefined`, so the applicability engine falls back to config-gate or "unknown" — it NEVER fabricates a
 *    symbol verdict. `nmCommand` is configurable so the caller can point at `arm-zephyr-eabi-nm` etc.
 *  - **Scanning the wrong build** → wrong applicability: this reader never guesses a build; the caller passes an
 *    explicit `buildDir` (the verified one). Absent evidence (no build) → `undefined` → honest "unknown".
 *  - The linked-symbol signal is only as sound as `--gc-sections` actually stripping (design/16 Fact 3, unproven
 *    until the spike) — which is why applicability treats "present" as a WEAK signal; this reader just supplies
 *    the raw dump, it asserts nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { BuildEvidence } from "./applicability"

export interface BuildEvidenceReaders {
	/** Read a text file; return undefined if missing/unreadable (never throw — absence is a valid, honest state). */
	readText: (filePath: string) => string | undefined
	/** Dump symbols from an ELF (`nm`); return undefined on any failure (wrong arch, missing tool, etc.). */
	nm: (elfPath: string) => string | undefined
}

export interface BuildEvidenceInput {
	/** The verified build directory (e.g. `build` or `build/<image>`); candidate .config/ELF paths derive from it. */
	buildDir?: string
	/** Explicit merged-Kconfig path — overrides the buildDir candidates. */
	dotConfigPath?: string
	/** Explicit ELF path — overrides the buildDir default. */
	elfPath?: string
	/** Explicit PRE-COMPUTED symbol-dump path (an `nm` output text file) — overrides everything; no `nm` is run.
	 *  Used by the pre-canned CRA Sample bundle (design/34): ship the small dump instead of a multi-MB ELF, and
	 *  don't depend on the user having a working `nm`. A real build leaves this unset → the `nm`-on-ELF path runs. */
	symbolsPath?: string
}

/** Candidate merged-Kconfig locations under a build dir: Zephyr (`zephyr/.config`) then a flat `.config` (ESP). */
const dotConfigCandidates = (buildDir: string): string[] => [
	path.join(buildDir, "zephyr", ".config"),
	path.join(buildDir, ".config"),
]

/** Candidate pre-computed symbol-dump locations under a build dir (the Sample bundle ships `zephyr/symbols.nm`). */
const symbolsDumpCandidates = (buildDir: string): string[] => [
	path.join(buildDir, "zephyr", "symbols.nm"),
	path.join(buildDir, "symbols.nm"),
]

/** Default Zephyr ELF location under a build dir. */
const defaultElf = (buildDir: string): string => path.join(buildDir, "zephyr", "zephyr.elf")

/** Resolve the merged .config + symbol dump into the `BuildEvidence` the applicability engine consumes. */
export function readBuildEvidence(input: BuildEvidenceInput, readers: BuildEvidenceReaders): BuildEvidence {
	let dotConfig: string | undefined
	if (input.dotConfigPath) {
		dotConfig = readers.readText(input.dotConfigPath)
	} else if (input.buildDir) {
		for (const candidate of dotConfigCandidates(input.buildDir)) {
			dotConfig = readers.readText(candidate)
			if (dotConfig !== undefined) {
				break
			}
		}
	}

	// Symbols: prefer a PRE-COMPUTED dump (explicit path, or a `symbols.nm` shipped in the bundle) — read as text,
	// no `nm` run. Only when no dump exists do we run `nm` on the ELF (the real-build path). This lets the Sample
	// bundle avoid shipping the ELF / depending on `nm`, while a real build behaves exactly as before.
	let symbols: string | undefined
	if (input.symbolsPath) {
		symbols = readers.readText(input.symbolsPath)
	} else if (input.buildDir) {
		for (const candidate of symbolsDumpCandidates(input.buildDir)) {
			symbols = readers.readText(candidate)
			if (symbols !== undefined) {
				break
			}
		}
	}
	if (symbols === undefined) {
		const elf = input.elfPath ?? (input.buildDir ? defaultElf(input.buildDir) : undefined)
		if (elf) {
			symbols = readers.nm(elf)
		}
	}

	return { dotConfig, symbols }
}

/** Production readers: fs for text, `nm` (configurable) for symbols. Both swallow errors → undefined (honest absence). */
export function defaultBuildEvidenceReaders(nmCommand = "nm"): BuildEvidenceReaders {
	return {
		readText: (filePath) => {
			try {
				return readFileSync(filePath, "utf8")
			} catch {
				return undefined
			}
		},
		nm: (elfPath) => {
			try {
				const out = execFileSync(nmCommand, [elfPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
				return out.trim() ? out : undefined
			} catch {
				return undefined
			}
		},
	}
}
