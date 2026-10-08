/**
 * Interactive pagers off in every terminal the agent drives.
 *
 * A `git log` or `git diff` without `--no-pager` opens `less` and waits for a key that never comes, so the
 * command never returns and the task stalls (the follow-up from the 5 Oct 2026 bench runs). The prompt
 * asks for `--no-pager`; this makes the stall impossible when it is forgotten. The background runner
 * (StandaloneTerminalProcess) already set the same four variables.
 */
export const NO_PAGER_ENV: Record<string, string> = {
	PAGER: "cat",
	GIT_PAGER: "cat",
	MANPAGER: "cat",
	SYSTEMD_PAGER: "",
}
