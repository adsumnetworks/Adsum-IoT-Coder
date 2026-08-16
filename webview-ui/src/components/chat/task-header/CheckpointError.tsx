import { useMemo } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}

/**
 * Checkpoint status banner.
 *
 * Three different situations used to share one red danger banner and one button, and the banner was
 * assembled by string-surgery on the message: the trailing sentence "…or disabling checkpoints." was
 * regex-stripped and replaced by a Disable button. Reported 2026-08-16, that produced a sentence which
 * ended mid-clause — "Consider re-opening Cline in a project that uses git, or" — followed by a button
 * the developer had no reason to trust, on a project where nothing was actually wrong.
 *
 * The three cases are now distinguished explicitly, because they call for different things:
 *
 *   working   — checkpoints are still initializing. Transient, self-resolving, nothing to do. Not an
 *               error, so not a danger banner and no action offered.
 *   inactive  — checkpoints are off for this task (timed out, or not applicable here). Worth stating
 *               once, calmly, with a route to settings for anyone who wants them off for good.
 *   error     — something genuinely failed (git missing). Danger banner, and the fix.
 */
type CheckpointState = "working" | "inactive" | "error"

function classify(message: string): CheckpointState {
	if (message.includes("Git must be installed")) {
		return "error"
	}
	// Still going: the 7s "be patient" notice. Says nothing is wrong, so it must not look like it is.
	if (message.includes("still initializing")) {
		return "working"
	}
	// Off for this task — timed out, unsupported layout, or a folder where checkpoints do not apply.
	if (
		message.includes("could not finish initializing") ||
		message.includes("checkpoints turn on by themselves") ||
		message.includes("multi-root workspaces") ||
		message.includes("off for this task")
	) {
		return "inactive"
	}
	return "error"
}

export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	const state = useMemo<CheckpointState | null>(
		() => (checkpointManagerErrorMessage ? classify(checkpointManagerErrorMessage) : null),
		[checkpointManagerErrorMessage],
	)

	if (!checkpointManagerErrorMessage || !state) {
		return null
	}

	return (
		<div className="flex items-center justify-center w-full">
			{/* The message is shown WHOLE. Nothing is trimmed to make room for a control — that is what
			    produced a sentence ending in "or". */}
			<Alert title={checkpointManagerErrorMessage} variant={state === "error" ? "danger" : "default"}>
				{state !== "working" && (
					<AlertDescription className="flex gap-2 justify-end">
						{state === "inactive" && (
							<Button aria-label="Checkpoint settings" onClick={handleCheckpointSettingsClick} variant="ghost">
								Checkpoint settings
							</Button>
						)}
						{state === "error" && (
							<a
								className="text-link underline"
								href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
								See instructions
							</a>
						)}
					</AlertDescription>
				)}
			</Alert>
		</div>
	)
}
