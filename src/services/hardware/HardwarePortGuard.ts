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
/**
 * A gateway reached over Bluetooth (the service tool's --ble, the LBG20x's only door) is held by its four-digit name:
 * "--ble AD50", "--ble D3588E7AAD50" and "--ble D3:58:8E:7A:AD:50" are one unit, "BLE:AD50". A bare --ble (the only
 * unit in range) is "BLE:ANY". A value that is a path is the command's folder, not a unit (update-pair --ble FOLDER).
 */
const BLE_RE = /(?:^|\s)--ble(?:[ =]([^\s-][^\s]*))?/g

function bleKey(value: string | undefined): string {
	const v = (value ?? "").trim().replace(/^["']|["']$/g, "")
	if (!v || /[\\/]/.test(v)) return "BLE:ANY"
	const hex = v.replace(/[:-]/g, "").toUpperCase()
	if (/^[0-9A-F]{12}$/.test(hex) || /^[0-9A-F]{4}$/.test(hex)) return `BLE:${hex.slice(-4)}`
	return `BLE:${v.toUpperCase()}`
}

const holders = new Map<string, PortHolder>()
/**
 * The session that last worked with a port or a unit, kept after it lets go: a Hardware page button for that unit
 * continues there instead of opening one more tab. Only an open tab counts; the host checks that.
 */
const lastUsers = new Map<string, string>()
let listeners: Array<() => void> = []

const norm = (port: string) => port.replace(/^\/dev\/cu\./, "/dev/tty.").toUpperCase()

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
	for (const m of command.matchAll(BLE_RE)) {
		out.add(bleKey(m[1]))
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
		lastUsers.set(p, holder.taskId)
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
	return holders.get(norm(port))
}

/**
 * A session parked on a question, a plan answer or "done, anything else?" runs nothing on the desk: what it named is
 * free for the other tabs now, not only when its tab closes (11 Oct 2026, the bench: "Read the logs" was refused for
 * four minutes by a tab that had answered and was only waiting). A command still running in one of its terminals
 * keeps the hold; a later command claims again.
 */
const PARKED_ASKS = new Set([
	"followup",
	"plan_mode_respond",
	"act_mode_respond",
	"completion_result",
	"resume_task",
	"resume_completed_task",
])

export function releaseWhenParked(taskId: string, ask: string, busyTerminals: number): boolean {
	if (!PARKED_ASKS.has(ask) || busyTerminals > 0) {
		return false
	}
	releaseAll(taskId)
	return true
}

/** A session was opened for this unit (a Hardware page button): the next button for the unit continues there. */
export function rememberUnitSession(unit: string, taskId: string): void {
	if (unit && taskId) {
		lastUsers.set(norm(unit), taskId)
	}
}

/** The session holding the unit now, else the one that last worked with it. */
export function sessionForUnit(unit: string): string | undefined {
	const key = norm(unit)
	return holders.get(key)?.taskId ?? lastUsers.get(key)
}

/**
 * How a new request reaches a session that is already open, read from its last message:
 *  - "answer": it waits on words (a question, a plan, done, resume); the request is its answer.
 *  - "queue": it is working; the request waits its turn in the session's queue.
 *  - "approval": it waits on a yes or no for a command or a tool; words there would mean "no", so nothing is sent.
 */
export type ContinueRoute = "answer" | "queue" | "approval"

export function continueRoute(
	last: { type?: string; ask?: string; partial?: boolean } | undefined,
	streaming: boolean,
): ContinueRoute {
	if (!last || last.type !== "ask" || last.partial || streaming || last.ask === "command_output") {
		return "queue"
	}
	return PARKED_ASKS.has(last.ask ?? "") ? "answer" : "approval"
}

/** The session is waiting on the developer's words and nothing else: no request in flight, no approval pending. */
export function isParkedOnWords(
	last: { type?: string; ask?: string; partial?: boolean } | undefined,
	streaming: boolean,
): boolean {
	return !!last && continueRoute(last, streaming) === "answer"
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
	lastUsers.clear()
	listeners = []
}
