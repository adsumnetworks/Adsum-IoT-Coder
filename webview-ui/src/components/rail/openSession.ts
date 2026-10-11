import { StringRequest } from "@shared/proto/cline/common"
import { AdsumServiceClient } from "@/services/grpc-client"

export interface OpenSessionIntent {
	/** An existing session: its tab is focused, never opened twice. */
	taskId?: string
	/** Text for a new session: sent as the first message when `send`, else placed in the composer. */
	prompt?: string
	send?: boolean
	title?: string
	/** With taskId: close that session's tab. */
	close?: boolean
	/** The unit this request is about; the host continues in the open session that already holds it. */
	unit?: string
}

/** What a button says about the session it opens, beside its prompt. */
export interface PromptOptions {
	/** Sent as the first message; else the prompt fills the box and waits for Enter. */
	send: boolean
	/** The tab's first title. Without one the tab reads "New session" until the session has a name of its own. */
	title?: string
	/** The unit the prompt is about (see OpenSessionIntent.unit). Left out for a request that gets its own session. */
	unit?: string
}

/**
 * [0.5 sessions first] The one way the rail starts or shows a session: the host opens an editor tab.
 * Every card click becomes a prompt the developer sees when the session starts: a run or a check fills
 * the composer and waits for Enter; a sample or a journey is sent as the first message.
 */
export async function openSession(intent: OpenSessionIntent): Promise<string> {
	try {
		const r = await AdsumServiceClient.openSession(StringRequest.create({ value: JSON.stringify(intent) }))
		return r.value ?? ""
	} catch (e) {
		console.error("[rail] openSession failed:", e)
		return ""
	}
}
