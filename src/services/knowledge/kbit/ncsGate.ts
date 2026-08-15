/**
 * SDK version gating for knowledge bits.
 *
 * A board bit can be perfectly valid knowledge and still describe a board target that does not exist in
 * the SDK the developer has installed. The XIAO nRF54LM20A needs NCS >= 3.3.0; nRF54LM20's
 * `cpuflpr/xip` target is documented upstream but absent from 3.3.1 entirely. Without a check, the agent
 * reads the bit, believes the target is available, and the developer discovers otherwise after a build.
 *
 * `min_ext` already gates on the EXTENSION version so the registry never serves a bit an old app cannot
 * run. This is the other axis: the TOOLCHAIN on the developer's machine. The host detects it already —
 * the only thing missing was comparing the two and saying so plainly.
 *
 * Deliberately advisory, never blocking. Nordic's own support matrix has three levels (unsupported /
 * experimental / supported), a developer may legitimately be on a newer SDK than a bit was written
 * against, and refusing to load knowledge because a version string looks wrong would be worse than the
 * problem. So we load the bit and state the mismatch.
 */

/** Compare two dotted version strings numerically. Leading "v" and any pre-release suffix are ignored. */
export function compareNcsVersions(a: string, b: string): number {
	const parse = (v: string): number[] =>
		v
			.trim()
			.replace(/^v/i, "")
			.split(/[-+]/)[0]
			.split(".")
			.map((n) => Number.parseInt(n, 10) || 0)
	const pa = parse(a)
	const pb = parse(b)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (d !== 0) {
			return d < 0 ? -1 : 1
		}
	}
	return 0
}

export interface NcsGateInput {
	/** Bit id, for naming the source of the requirement. */
	bitId: string
	/** Human title of the bit, when known. */
	title?: string
	/** The bit's declared minimum, from frontmatter. */
	minNcs?: string
	/** Toolchains detected on this machine. */
	installed: string[]
	/** The version this project is pinned to by its build, when it has one. */
	projectPin?: string
}

/**
 * Build the advisory line for one bit, or null when there is nothing to say.
 *
 * The message names the requirement, what is actually installed, and the action — an agent that reads
 * "requires 3.3.0" with no further context tends to either ignore it or invent a fix.
 */
export function ncsGateNotice(input: NcsGateInput): string | null {
	const { bitId, title, minNcs, installed, projectPin } = input
	if (!minNcs) {
		return null
	}

	const known = [...installed, ...(projectPin ? [projectPin] : [])].filter(Boolean)
	if (known.length === 0) {
		// Nothing detected yet. Say what is needed rather than staying silent — the developer may have no
		// SDK installed at all, which is exactly when this matters most.
		return (
			`⚠ ${title ?? bitId} requires nRF Connect SDK **${minNcs}** or newer. No NCS toolchain has been ` +
			`detected on this machine yet. Confirm the installed version before building for this board.`
		)
	}

	// The best available version wins: several toolchains can be installed side by side, and having a new
	// enough one somewhere is what matters.
	const best = known.reduce((hi, v) => (compareNcsVersions(v, hi) > 0 ? v : hi), known[0])
	if (compareNcsVersions(best, minNcs) >= 0) {
		return null
	}

	const pinNote = projectPin && compareNcsVersions(projectPin, minNcs) < 0 ? ` This project is pinned to ${projectPin}.` : ""
	return (
		`⚠ ${title ?? bitId} requires nRF Connect SDK **${minNcs}** or newer, but the newest installed ` +
		`toolchain is **${best}**.${pinNote} Tell the developer this before building: the board target will ` +
		`not resolve on ${best}, and a build failure will look like a mistake in their project rather than a ` +
		`missing SDK. Installing a newer NCS through the nRF Connect extension's Toolchain Manager is the fix.`
	)
}
