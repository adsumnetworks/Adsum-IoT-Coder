/** The webview panel type VS Code uses to find the session serializer after a reload. */
export const SESSION_PANEL_TYPE = "adsum-iot-coder.session"

/** One editor group, as much of it as the choice below needs. */
export interface EditorGroupLike {
	active: boolean
	viewColumn: number
	/** The view type of the group's front tab when it is a webview. */
	frontWebviewType?: string
}

const isSession = (g: EditorGroupLike) => !!g.frontWebviewType?.includes(SESSION_PANEL_TYPE)

/**
 * [0.5 sessions first] Where the agent opens a file or a change view while the developer looks at a session tab.
 *
 * A session is an editor tab now. Anything the agent opened landed in the same group, on top of the conversation
 * (Omar, 0.5: "he opens the page instead of splitting the screen"). So when the front tab of the active group is a
 * session, the document goes to another group: one that is not showing a session if there is one, else a new group
 * beside. Returns a column, "beside" for a new group, or undefined when the active tab is not a session (the
 * editor decides, as it always did).
 */
export function columnBesideSession(groups: readonly EditorGroupLike[]): number | "beside" | undefined {
	const active = groups.find((g) => g.active)
	if (!active || !isSession(active)) {
		return undefined
	}
	const other = groups.find((g) => g !== active && !isSession(g))
	return other ? other.viewColumn : "beside"
}
