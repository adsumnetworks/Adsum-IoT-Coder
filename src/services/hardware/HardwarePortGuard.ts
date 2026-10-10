/**
 * [0.5 sessions first] One bench, several sessions. When a session tab opens a serial port or a debug probe,
 * the others are told WHICH session holds it instead of fighting for it or ending its process. The guard is
 * an extension-host singleton, beside StateManager: every controller asks it, none owns it.
 *
 * It is a registry, not a lock: the operating system still decides who really has the port. What the guard
 * adds is the name, so the agent can say "held by LEW840x gateway build" and ask, which is the rule.
 */
export interface PortHolder {
	taskId: string
	title: string
	since: number
}

const PORT_RE = /(\/dev\/(tty|cu)\.[A-Za-z0-9_.-]+|\/dev\/tty(ACM|USB)\d+|\bCOM\d+\b)/gi
/** A nine-digit number is a J-Link serial only beside a probe tool; alone it is a number. */
const PROBE_TOOL = /nrfutil|jlink|j-link|--serial-number|--snr\b|nrfjprog|pyocd|openocd/i
const SERIAL_RE = /\b[0-9]{9}\b/g

const holders = new Map<string, PortHolder>()
let listeners: Array<() => void> = []

const notify = () => {
	for (const l of listeners) {
		try {
			l()
		} catch {
			// a listener must never break the guard
		}
	}
}

/** Ports and probe serials a command names, normalised. */
export function portsInCommand(command: string): string[] {
	const out = new Set<string>()
	for (const m of command.matchAll(PORT_RE)) {
		out.add(m[0].replace(/^\/dev\/cu\./, "/dev/tty.").toUpperCase())
	}
	if (PROBE_TOOL.test(command)) {
		for (const m of command.matchAll(SERIAL_RE)) {
			out.add(m[0])
		}
	}
	return [...out]
}

/** Records that a task is using these ports. Returns the ports another task already holds. */
export function claimPorts(ports: readonly string[], holder: PortHolder): PortHolder[] {
	const others: PortHolder[] = []
	for (const p of ports) {
		const h = holders.get(p)
		if (h && h.taskId !== holder.taskId) {
			others.push({ ...h })
			continue
		}
		holders.set(p, { ...holder, since: h?.since ?? Date.now() })
	}
	if (ports.length) {
		notify()
	}
	return others
}

/** A task ended or was closed: everything it held is free. */
export function releaseAll(taskId: string): void {
	let changed = false
	for (const [p, h] of holders) {
		if (h.taskId === taskId) {
			holders.delete(p)
			changed = true
		}
	}
	if (changed) {
		notify()
	}
}

export function holderOf(port: string): PortHolder | undefined {
	return holders.get(port.replace(/^\/dev\/cu\./, "/dev/tty.").toUpperCase())
}

/** Everything held right now, for the rail and the status bar. */
export function allHolders(): Array<{ port: string; holder: PortHolder }> {
	return [...holders.entries()].map(([port, holder]) => ({ port, holder: { ...holder } }))
}

export function onHoldersChanged(listener: () => void): () => void {
	listeners.push(listener)
	return () => {
		listeners = listeners.filter((l) => l !== listener)
	}
}

/** The sentence the agent gets when a port it named is another session's. */
export function heldElsewhereMessage(others: readonly PortHolder[]): string {
	const names = others.map((o) => `"${o.title || o.taskId}"`).join(", ")
	return (
		`Refused for now: ${others.length === 1 ? "that port is" : "those ports are"} in use by another open session (${names}). ` +
		"Tell the developer which session holds it and ask whether to continue there or to end that session's use of " +
		"the port; never end another session's process yourself."
	)
}

/** Test seam. */
export function resetPortGuardForTest(): void {
	holders.clear()
	listeners = []
}
