import { TerminalOutputFailureReason, telemetryService } from "@services/telemetry"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import { stripAnsi } from "@/hosts/vscode/terminal/ansiUtils"
import { getLatestTerminalOutput } from "@/hosts/vscode/terminal/get-latest-output"
import { endEventDecision, isCompoundCommand } from "@/hosts/vscode/terminal/terminalEndEvents"
import {
	isCompilingOutput,
	MAX_FULL_OUTPUT_SIZE,
	MAX_UNRETRIEVED_LINES,
	PROCESS_HOT_TIMEOUT_COMPILING,
	PROCESS_HOT_TIMEOUT_NORMAL,
	SILENT_COMMAND_BACKSTOP_MS,
	TRAILING_CHUNK_GRACE_MS,
	TRUNCATE_KEEP_LINES,
} from "@/integrations/terminal/constants"
import type { ITerminalProcess, TerminalProcessEvents } from "@/integrations/terminal/types"
import { Logger } from "@/services/logging/Logger"

/**
 * VscodeTerminalProcess - Manages command execution in VSCode's integrated terminal.
 *
 * This class handles command execution using VSCode's shell integration API.
 * It processes VSCode-specific escape sequences and streams output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 *
 * Events:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available
 */
export class VscodeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null

	async run(terminal: vscode.Terminal, command: string) {
		// When command does not produce any output, return the current terminal contents as a fallback.
		// Two very different situations share this helper — the message must not conflate them (a real CRA run
		// read the old blanket "technical issue" text on a silent `mkdir -p` and treated success as a capture
		// failure; the kbits even carry a rule for it):
		//  - "silent": shell integration RAN the command and the stream completed with no output — for most
		//    such commands (mkdir, cp, Set-Content, …) that IS success, not a capture problem.
		//  - "no-integration": we sent the command blind (no shell integration) — output genuinely
		//    could not be captured and success is unknown.
		const returnCurrentTerminalContents = async (
			reason: "silent" | "no-integration" | "backstop",
		): Promise<string | undefined> => {
			try {
				// A FALLBACK MUST NOT OUTLAST THE FAILURE IT COVERS.
				//
				// getLatestTerminalOutput() is a clipboard round-trip — terminal.selectAll, copySelection,
				// then readTextFromClipboard. Over Remote-SSH the clipboard belongs to the LOCAL client while
				// these commands are issued from the remote extension host, and that round-trip can simply
				// never come back: no error, no rejection, just a promise that never settles. This is the
				// only await between the command finishing and `completed` being emitted, so when it hangs
				// the run sits at "Pending" over a command whose output is visible in the terminal beside it.
				//
				// It is reached precisely when the stream delivered nothing, which is the same intermittent
				// case the end-event backstop above exists for — so the two failures compound: the marker is
				// lost, the fallback is tried, and the fallback is what actually hangs.
				//
				// Bounded rather than removed: when it works it is genuinely useful (it is what turns a
				// silent `mkdir` into "ran to completion, produced no output"). When it does not answer in a
				// few seconds, no snapshot is better than no run.
				const terminalSnapshot = await getLatestTerminalOutput()
				if (terminalSnapshot && terminalSnapshot.trim()) {
					const framing =
						reason === "backstop"
							? `The command never signalled that it finished: nothing was printed and no end-of-command marker arrived for ${Math.round(SILENT_COMMAND_BACKSTOP_MS / 60000)} minutes, so waiting was stopped. This is NOT success and NOT failure — it usually means the command is waiting for keyboard input (a tool that opened an interactive prompt), or is still running. Read the terminal content below to see which; if something is prompting, re-run the command in a non-interactive form rather than answering it. Current terminal content:`
							: reason === "silent"
								? "The command ran to completion and produced no output stream — many commands (mkdir, cp, Set-Content, …) are silent on success. Do NOT treat this as a failure or as evidence about state; if the result matters, verify it directly (list/read the target). Current terminal content for reference:"
								: "The command's output could not be captured (this terminal has no shell-integration capture), so its result is unverified from the output alone. Here's the current terminal's content to help you get the command's output:"
					return `${framing}\n\n${terminalSnapshot}`
				}
			} catch (error) {
				console.error("Error capturing terminal output:", error)
			}
			return undefined
		}

		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			// Track that we're using shell integration
			//
			// The Logger breadcrumbs below exist because this loop hung four different ways on 2026-08-24 and
			// every diagnosis had to be guessed: console.log is NOT captured in the extension output channel,
			// so earlier diagnostics here were invisible. These lines make the next stuck run name its own
			// parked await in "1-Adsum IoT Coder.log" instead.
			Logger.info(`[TerminalProcess] executeCommand via shell integration: ${command.slice(0, 80)}`)
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			// todo: need to handle errors
			let isFirstChunk = true
			let didOutputNonCommand = false
			let didEmitEmptyLine = false

			/**
			 * THE STREAM IS NOT THE ONLY WITNESS THAT A COMMAND FINISHED.
			 *
			 * `execution.read()` ends when VS Code sees the shell's end-of-command marker (OSC 633;D). When
			 * that marker is missed — and it is, intermittently — this loop simply never returns. `completed`
			 * is never emitted, the run sits at "Pending" forever, and the terminal beside it plainly shows
			 * the command finished and printed its output. Observed on the bench 2026-08-24: two `echo`s
			 * completed, then `mkdir -p … && echo "writable"` printed `writable` and hung the run.
			 *
			 * VS Code reports the same fact a second way, through `onDidEndTerminalShellExecution`, which is
			 * not derived from the stream. Listening to it costs nothing and turns a hang into, at worst, a
			 * short wait.
			 *
			 * The grace period matters: the end event can arrive just before the last chunks, so once it has
			 * fired we keep reading and only stop when the stream goes quiet for TRAILING_CHUNK_GRACE_MS.
			 * Nothing is armed before the event, so a long silent build is never cut short — the timeout can
			 * only start after VS Code has said the command is over.
			 */
			let executionEnded = false
			/**
			 * The end signal must be a PROMISE in the race, not a boolean read before blocking.
			 *
			 * The first version of this backstop checked `executionEnded` once per iteration and then did a
			 * bare `await next`. For the very stream it exists to rescue — one that delivers ZERO chunks —
			 * that await blocks immediately and forever, and the end event that fires moments later has
			 * nobody listening for it. Measured on the bench 2026-08-24: a completed `mkdir` showed 12
			 * output events in the transcript; the stuck `cat … && wc -l` showed 0, with VS Code's own
			 * command decorations proving the command end WAS detected. The rescue existed and was parked
			 * behind the exact await it was meant to bound.
			 *
			 * Matching is belt-and-braces because the event's `execution` object is not guaranteed to be
			 * reference-equal to ours across the extension-host API layer: reference first, then the
			 * command line the execution reports, then same-terminal-after-500ms (a stale end event for a
			 * PREVIOUS command on this terminal arrives within milliseconds of our start; ours cannot).
			 */
			let signalEnd: (() => void) | undefined
			const endSeen = new Promise<void>((resolve) => {
				signalEnd = resolve
			})
			/**
			 * SEQUENCE, don't match. The matching version of this listener failed in production with one log
			 * line — "end event for a DIFFERENT execution — ignored" — and then silence. The event's
			 * `execution` is not reference-equal to the object `executeCommand` returned (different wrappers
			 * across the extension-host API), its commandLine did not equal our command string, and the
			 * 500 ms anti-stale guard rejected any terminal-matched event that arrived quickly — which is
			 * precisely when a fast command's GENUINE end event arrives. The rescue rejected the rescue.
			 *
			 * The property that is actually reliable: VS Code serialises shell executions per terminal, so a
			 * previous command's end event always fires before our start event. Therefore: before our start
			 * event is seen, an end event on this terminal is stale — ignore it; after our start event, the
			 * next end event on this terminal is OURS, whatever object identity it carries. Reference and
			 * commandLine stay as fast paths for when the start event itself is missed.
			 */
			let sawOurStart = false
			// Sub-command bookkeeping for a compound command: shell integration reports a start and an end
			// per sub-command, so the command is over when every start it announced has been matched.
			let startsSeen = 0
			let endsSeen = 0
			// Reached through a narrow local shape rather than the ambient type: this extension's
			// @types/vscode (1.84) predates both shell-execution events (1.93) — the optional calls mean an
			// older VS Code simply never arms the backstop instead of throwing.
			const windowWithShellEvents = vscode.window as unknown as {
				onDidStartTerminalShellExecution?: (listener: (e: { execution: unknown; terminal?: unknown }) => void) => {
					dispose: () => void
				}
				onDidEndTerminalShellExecution?: (listener: (e: { execution: unknown; terminal?: unknown }) => void) => {
					dispose: () => void
				}
			}
			const startListener = windowWithShellEvents.onDidStartTerminalShellExecution?.((e) => {
				if (e.terminal === terminal) {
					startsSeen++
					sawOurStart = true
					const line = (e.execution as { commandLine?: { value?: string } })?.commandLine?.value
					Logger.info(`[TerminalProcess] start event on our terminal (cmd=${line?.slice(0, 60) ?? "?"})`)
				}
			})
			// Every rule about WHICH end event is ours lives in terminalEndEvents.ts, where it is tested
			// against the incidents that produced it. This listener only reports the facts and obeys.
			const compound = isCompoundCommand(command)
			const endListener = windowWithShellEvents.onDidEndTerminalShellExecution?.((e) => {
				const decision = endEventDecision({
					byRef: e.execution === execution,
					sameTerminal: e.terminal === terminal,
					sawOurStart,
					isCompound: compound,
					startsSeen,
					endsSeen,
				})
				if (e.terminal === terminal && sawOurStart) {
					endsSeen++
				}
				if (decision.accept) {
					Logger.info(`[TerminalProcess] end event accepted (${decision.why})`)
					executionEnded = true
					signalEnd?.()
				} else {
					Logger.info(`[TerminalProcess] end event not ours (${decision.why})`)
				}
			})
			if (compound) {
				// Say it out loud in the log: a compound command cannot use the sequence rule, so it will
				// complete on reference identity or on the silence backstop, and that is slower on purpose.
				Logger.info("[TerminalProcess] compound command — end events arrive per sub-command; sequence rule disabled")
			}
			if (!endListener) {
				Logger.info("[TerminalProcess] onDidEndTerminalShellExecution UNAVAILABLE — backstop not armed")
			}
			let sawFirstChunk = false
			/**
			 * ...AND AN END EVENT THAT NEVER COMES IS NOT A WITNESS EITHER.
			 *
			 * Both rescues above assume the command ends. An interactive one does not: on 2026-08-24 a driven
			 * run sent `JLinkExe … -CommanderScript`, J-Link did not recognise the device and opened its
			 * selection prompt, and the run sat at "Pending" for 8½ minutes over a terminal that was plainly
			 * showing the question. Start event fired, no chunk, no end event, nothing bounded the wait.
			 *
			 * So the race gets a third arm: total silence for SILENT_COMMAND_BACKSTOP_MS ends the loop and
			 * hands back what the terminal is showing — which is exactly the prompt the agent needs to see to
			 * fix its own command. Every chunk re-arms it, so this can only fire on a command that is
			 * producing nothing at all.
			 */
			let backstopFired = false
			const silenceOut = () => {
				let timer: NodeJS.Timeout | undefined
				const promise = new Promise<{ kind: "silence" }>((resolve) => {
					timer = setTimeout(() => resolve({ kind: "silence" }), SILENT_COMMAND_BACKSTOP_MS)
				})
				return { promise, cancel: () => timer && clearTimeout(timer) }
			}
			const iterator = stream[Symbol.asyncIterator]()
			const graceOut = (): Promise<IteratorResult<string>> =>
				new Promise((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), TRAILING_CHUNK_GRACE_MS))
			try {
				for (;;) {
					const next = iterator.next()
					let step: IteratorResult<string>
					if (executionEnded) {
						// Already ended: drain whatever trailing chunks land, stop when quiet.
						step = await Promise.race([next, graceOut()])
					} else {
						// Not ended yet: wait for a chunk OR the end event OR a long silence — never a bare
						// await on the stream.
						const silence = silenceOut()
						const first = await Promise.race([
							next.then((r) => ({ kind: "chunk" as const, r })),
							endSeen.then(() => ({ kind: "end" as const })),
							silence.promise,
						])
						silence.cancel()
						if (first.kind === "silence") {
							Logger.info(
								`[TerminalProcess] silent for ${SILENT_COMMAND_BACKSTOP_MS}ms with no end event — giving up on shell integration`,
							)
							backstopFired = true
							break
						}
						if (first.kind === "chunk") {
							step = first.r
						} else {
							Logger.info("[TerminalProcess] end event won the race — draining with grace timeout")
							step = await Promise.race([next, graceOut()])
						}
					}
					if (step.done) {
						Logger.info(`[TerminalProcess] stream loop exit (sawFirstChunk=${sawFirstChunk} ended=${executionEnded})`)
						break
					}
					if (!sawFirstChunk) {
						sawFirstChunk = true
						Logger.info("[TerminalProcess] first chunk received")
					}
					let data = step.value
					// 1. Process chunk and remove artifacts
					if (isFirstChunk) {
						/*
					The first chunk we get from this stream needs to be processed to be more human readable, ie remove vscode's custom escape sequences and identifiers, removing duplicate first char bug, etc.
					*/

						// bug where sometimes the command output makes its way into vscode shell integration metadata
						/*
					]633 is a custom sequence number used by VSCode shell integration:
					- OSC 633 ; A ST - Mark prompt start
					- OSC 633 ; B ST - Mark prompt end
					- OSC 633 ; C ST - Mark pre-execution (start of command output)
					- OSC 633 ; D [; <exitcode>] ST - Mark execution finished with optional exit code
					- OSC 633 ; E ; <commandline> [; <nonce>] ST - Explicitly set command line with optional nonce
					*/
						// if you print this data you might see something like "eecho hello worldo hello world;5ba85d14-e92a-40c4-b2fd-71525581eeb0]633;C" but this is actually just a bunch of escape sequences, ignore up to the first ;C
						/* ddateb15026-6a64-40db-b21f-2a621a9830f0]633;CTue Sep 17 06:37:04 EDT 2024 % ]633;D;0]633;P;Cwd=/Users/saoud/Repositories/test */
						// Gets output between ]633;C (command start) and ]633;D (command end)
						const outputBetweenSequences = this.removeLastLineArtifacts(
							data.match(/\]633;C([\s\S]*?)\]633;D/)?.[1] || "",
						).trim()

						// Once we've retrieved any potential output between sequences, we can remove everything up to end of the last sequence
						// https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
						const vscodeSequenceRegex = /\x1b\]633;.[^\x07]*\x07/g
						const lastMatch = [...data.matchAll(vscodeSequenceRegex)].pop()
						if (lastMatch && lastMatch.index !== undefined) {
							data = data.slice(lastMatch.index + lastMatch[0].length)
						}
						// Place output back after removing vscode sequences
						if (outputBetweenSequences) {
							data = outputBetweenSequences + "\n" + data
						}
						// remove ansi
						data = stripAnsi(data)
						// Split data by newlines
						const lines = data ? data.split("\n") : []
						// Remove non-human readable characters from the first line
						if (lines.length > 0) {
							lines[0] = lines[0].replace(/[^\x20-\x7E]/g, "")
						}
						// Check for duplicated first character that might be a terminal artifact
						// But skip this check for known syntax characters like {, [, ", etc.
						if (
							lines.length > 0 &&
							lines[0].length >= 2 &&
							lines[0][0] === lines[0][1] &&
							!["[", "{", '"', "'", "<", "("].includes(lines[0][0])
						) {
							lines[0] = lines[0].slice(1)
						}
						// Only remove specific terminal artifacts from line beginnings while preserving JSON syntax
						if (lines.length > 0) {
							// This regex only removes common terminal artifacts (%, $, >, #) and invisible control chars
							// but preserves important syntax chars like {, [, ", etc.
							lines[0] = lines[0].replace(/^[\x00-\x1F%$>#\s]*/, "")
						}
						if (lines.length > 1) {
							lines[1] = lines[1].replace(/^[\x00-\x1F%$>#\s]*/, "")
						}
						// Join lines back
						data = lines.join("\n")
						isFirstChunk = false
					} else {
						data = stripAnsi(data)
					}

					// Ctrl+C detection: if user presses Ctrl+C, treat as command terminated
					if (data.includes("^C") || data.includes("\u0003")) {
						if (this.hotTimer) {
							clearTimeout(this.hotTimer)
						}
						this.isHot = false
						break
					}

					// first few chunks could be the command being echoed back, so we must ignore
					// note this means that 'echo' commands won't work
					if (!didOutputNonCommand) {
						const lines = data.split("\n")
						for (let i = 0; i < lines.length; i++) {
							if (command.includes(lines[i].trim())) {
								lines.splice(i, 1)
								i-- // Adjust index after removal
							} else {
								didOutputNonCommand = true
								break
							}
						}
						data = lines.join("\n")
					}

					// 2. Set isHot depending on the command
					// Set to hot to stall API requests until terminal is cool again
					this.isHot = true
					if (this.hotTimer) {
						clearTimeout(this.hotTimer)
					}
					// these markers indicate the command is some kind of local dev server recompiling the app, which we want to wait for output of before sending request to cline
					const isCompiling = isCompilingOutput(data)
					this.hotTimer = setTimeout(
						() => {
							this.isHot = false
						},
						isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
					)

					// For non-immediately returning commands we want to show loading spinner right away but this wouldn't happen until it emits a line break, so as soon as we get any output we emit "" to let webview know to show spinner
					// This is only done for the sake of unblocking the UI, in case there may be some time before the command emits a full line
					if (!didEmitEmptyLine && !this.fullOutput && data) {
						this.emit("line", "") // empty line to indicate start of command output stream
						didEmitEmptyLine = true
					}

					this.fullOutput += data

					// Cap fullOutput at MAX_FULL_OUTPUT_SIZE to prevent memory exhaustion
					if (this.fullOutput.length > MAX_FULL_OUTPUT_SIZE) {
						// Keep last half of max size
						this.fullOutput = this.fullOutput.slice(-MAX_FULL_OUTPUT_SIZE / 2)
						// Reset lastRetrievedIndex since we truncated the beginning
						this.lastRetrievedIndex = 0
					}

					if (this.isListening) {
						this.emitIfEol(data)
						this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
					}
				}
			} finally {
				startListener?.dispose()
				endListener?.dispose()
			}

			this.emitRemainingBufferIfListening()

			// A backstopped command that DID print keeps its output — but the output must not read as the
			// whole story, or a half-finished capture gets reported as a finished one.
			if (backstopFired && this.fullOutput.trim()) {
				this.emit(
					"line",
					`[Adsum] Output above is partial: the command then went silent for ${Math.round(SILENT_COMMAND_BACKSTOP_MS / 60000)} minutes without finishing, so waiting was stopped. It may still be running or waiting for input.`,
				)
			}

			// the command process is finished, let's check the output to see if we need to use the terminal capture fallback
			if (!this.fullOutput.trim()) {
				Logger.info("[TerminalProcess] no stream output — taking terminal-snapshot fallback")
				// No output captured via shell integration, trying fallback
				telemetryService.captureTerminalOutputFailure(TerminalOutputFailureReason.TIMEOUT, "vscode")
				const postCompletionOutput = await returnCurrentTerminalContents(backstopFired ? "backstop" : "silent")
				// Check if fallback worked
				if (postCompletionOutput) {
					telemetryService.captureTerminalExecution(true, "vscode", "clipboard")
				} else {
					telemetryService.captureTerminalExecution(false, "vscode", "none")
				}

				// Resolve the orchestrator's promise BEFORE emitting lines so we don't block
				if (this.hotTimer) clearTimeout(this.hotTimer)
				this.isHot = false
				Logger.info("[TerminalProcess] emitting completed")
				this.emit("completed")
				this.emit("continue")

				if (postCompletionOutput) {
					setTimeout(() => {
						this.emit("line", postCompletionOutput)
					}, 50)
				}
			} else {
				// Shell integration worked
				telemetryService.captureTerminalExecution(true, "vscode", "shell_integration")

				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				this.isHot = false
				Logger.info("[TerminalProcess] emitting completed")
				this.emit("completed")
				this.emit("continue")
			}
		} else {
			// no shell integration detected, we'll fallback to running the command and capturing the terminal's output after some time
			telemetryService.captureTerminalOutputFailure(TerminalOutputFailureReason.NO_SHELL_INTEGRATION, "vscode")
			terminal.sendText(command, true)

			// wait based on command type (nrfutil logs etc)
			let waitMs = 3000
			const durationMatch = command.match(/--duration\s+(\d+)/)
			if (durationMatch) {
				waitMs = (parseInt(durationMatch[1], 10) + 2) * 1000
			} else if (command.includes("--capture") || command.includes("--monitor") || command.includes("--test")) {
				waitMs = 32000
			}
			await new Promise((resolve) => setTimeout(resolve, waitMs))

			// For terminals without shell integration, also try to capture terminal content
			const postCompletionOutput = await returnCurrentTerminalContents("no-integration")
			// Check if clipboard fallback worked
			if (postCompletionOutput) {
				telemetryService.captureTerminalExecution(true, "vscode", "clipboard")
			} else {
				telemetryService.captureTerminalExecution(false, "vscode", "none")
			}

			// For terminals without shell integration, we can't know when the command completes
			// Emit completion FIRST so that Orchestrator marks process as continued,
			// which prevents output chunks from hanging the UI awaiting user response
			Logger.info("[TerminalProcess] emitting completed")
			this.emit("completed")
			this.emit("continue")
			this.emit("no_shell_integration")

			if (postCompletionOutput) {
				setTimeout(() => {
					this.emit("line", postCompletionOutput)
				}, 50)
			}
		}
	}

	// Inspired by https://github.com/sindresorhus/execa/blob/main/lib/transform/split.js
	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
			// Remove \r if present (for Windows-style line endings)
			// if (line.endsWith("\r")) {
			// 	line = line.slice(0, -1)
			// }
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	private emitRemainingBufferIfListening() {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * Truncates if output is too large to prevent context window overflow.
	 * @returns The unretrieved output (truncated if necessary)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length

		// Truncate if too many lines to prevent context overflow
		const lines = unretrieved.split("\n")
		if (lines.length > MAX_UNRETRIEVED_LINES) {
			const first = lines.slice(0, TRUNCATE_KEEP_LINES)
			const last = lines.slice(-TRUNCATE_KEEP_LINES)
			const skipped = lines.length - first.length - last.length
			return this.removeLastLineArtifacts([...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join("\n"))
		}

		return this.removeLastLineArtifacts(unretrieved)
	}

	// some processing to remove artifacts like '%' at the end of the buffer (it seems that since vsode uses % at the beginning of newlines in terminal, it makes its way into the stream)
	// This modification will remove '%', '$', '#', or '>' followed by optional whitespace
	removeLastLineArtifacts(output: string) {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			// Remove prompt characters and trailing whitespace from the last line
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}
}

export type TerminalProcessResultPromise = VscodeTerminalProcess & Promise<void>

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise: https://github.com/sindresorhus/execa/blob/main/lib/methods/promise.js
export function mergePromise(process: VscodeTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const,
	)
	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}
	return process as TerminalProcessResultPromise
}
