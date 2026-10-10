import { WebviewProvider } from "@core/webview"
import type { OpenSessionSummary } from "@/shared/ExtensionMessage"

/**
 * [0.5 sessions first] What the rail and the status bar know about the open session tabs. Computed from the
 * webview registry on demand; `sessionsChanged()` repaints the sidebar so its Sessions block marks the rows
 * that have a tab, and the status bar leads with a session that waits on an answer.
 */
export function openSessions(): OpenSessionSummary[] {
	const out: OpenSessionSummary[] = []
	for (const w of WebviewProvider.getSessionInstances()) {
		const task = w.controller.task
		if (!task) {
			continue
		}
		const messages = task.messageStateHandler.getClineMessages()
		const last = messages[messages.length - 1]
		const waiting = !!last && last.type === "ask" && !last.partial && !task.taskState.isStreaming
		const history = w.controller.stateManager.getGlobalStateKey("taskHistory") || []
		const item = history.find((h) => h.id === task.taskId)
		out.push({
			taskId: task.taskId,
			title: (item?.title || item?.task || "").slice(0, 80),
			waiting,
			streaming: !!task.taskState.isStreaming,
			active: w.isVisible(),
		})
	}
	return out
}

let listeners: Array<() => void> = []

/** Called whenever a tab opens, closes, focuses or its task changes. */
export function sessionsChanged(): void {
	for (const l of listeners) {
		try {
			l()
		} catch (e) {
			console.warn("[sessions] listener failed:", e instanceof Error ? e.message : String(e))
		}
	}
	try {
		void WebviewProvider.getSidebarInstance().controller.postStateToWebview()
	} catch {
		// no sidebar yet
	}
}

export function onSessionsChanged(listener: () => void): () => void {
	listeners.push(listener)
	return () => {
		listeners = listeners.filter((l) => l !== listener)
	}
}
