import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import type { OpenSessionSummary } from "@/shared/ExtensionMessage"
import type { Controller } from "../index"

export interface OpenSessionIntent {
	taskId?: string
	prompt?: string
	send?: boolean
	title?: string
}

/** The host registers how a session tab is opened; the controller never imports VS Code for it. */
let opener: ((intent: OpenSessionIntent) => Promise<string | undefined>) | undefined

export function registerSessionOpener(fn: typeof opener): void {
	opener = fn
}

/** The host registers how the open tabs are listed; the controller puts the answer in its state. */
let lister: (() => OpenSessionSummary[]) | undefined

export function registerOpenSessionsProvider(fn: typeof lister): void {
	lister = fn
}

export function listOpenSessions(): OpenSessionSummary[] {
	try {
		return lister?.() ?? []
	} catch {
		return []
	}
}

/**
 * [0.5 sessions first] The rail asks for a session: a card click, a session row, +, or Enter in a prefilled
 * composer. Request value is JSON {taskId?, prompt?, send?, title?}. Response value is the task id when a
 * task started or was shown, else "".
 */
export async function openSession(_controller: Controller, request: StringRequest): Promise<ProtoString> {
	let intent: OpenSessionIntent = {}
	try {
		intent = request.value ? (JSON.parse(request.value) as OpenSessionIntent) : {}
	} catch {
		return ProtoString.create({ value: "" })
	}
	if (!opener) {
		return ProtoString.create({ value: "" })
	}
	const id = await opener(intent)
	return ProtoString.create({ value: id ?? "" })
}
