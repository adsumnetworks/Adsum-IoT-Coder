import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import type { OpenSessionSummary } from "@/shared/ExtensionMessage"
import type { HistoryItem } from "@/shared/HistoryItem"
import type { Controller } from "../index"

export interface OpenSessionIntent {
	taskId?: string
	prompt?: string
	send?: boolean
	title?: string
	/** With taskId: close that session's tab (the task header's × in a tab means close, not clear). */
	close?: boolean
	/**
	 * The unit this request is about, as the port guard names it ("BLE:AD50", "/DEV/TTYACM4"). With a prompt that
	 * is sent at once, the request continues in the open session that already works with that unit, instead of
	 * opening one more tab that the first would refuse the unit to.
	 */
	unit?: string
}

/** The host registers how a session tab is opened; the controller never imports VS Code for it. */
let opener: ((intent: OpenSessionIntent) => Promise<string | undefined>) | undefined

export function registerSessionOpener(fn: typeof opener): void {
	opener = fn
}

/**
 * The host hears every save of a session's history row, so its tab can carry the session's own title and the rail
 * its marks. A typed first message never told the tab anything: the tab read "New session" until it was reopened.
 */
let historyListener: ((item: HistoryItem) => void) | undefined

export function registerHistoryListener(fn: typeof historyListener): void {
	historyListener = fn
}

export function historyItemSaved(item: HistoryItem): void {
	try {
		historyListener?.(item)
	} catch {
		// a tab's title never breaks a save
	}
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
 * composer. Request value is JSON {taskId?, prompt?, send?, title?, unit?}. Response value is the task id when a
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
