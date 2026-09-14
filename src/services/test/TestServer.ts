import { WebviewProvider } from "@core/webview"
import { Logger } from "@services/logging/Logger"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ApiProvider } from "@shared/api"
import { execa } from "execa"
import * as http from "http"
import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { ExtensionRegistryInfo } from "@/registry"
import { getCwd } from "@/utils/path"
import { checkRespond, messagesSince, pendingAskFrom, sessionStateFrom } from "./askBridge"
import { initializeGitRepository, validateWorkspacePath } from "./GitHelper"
import { checkInject } from "./injectQueue"
import { checkClaim, claim, type Lease } from "./sessionLease"

/**
 * Creates a tracker to monitor tool calls and failures during task execution
 * @returns Object tracking tool calls and failures
 */
/** Who is driving, for as long as this extension host lives. See sessionLease.ts. */
let currentLease: Lease | null = null

let testServer: http.Server | undefined
let messageCatcherDisposable: vscode.Disposable | undefined

/**
 * Updates the auto approval settings to enable all actions
 * @param context The VSCode extension context
 * @param controller The webview provider instance
 */
async function updateAutoApprovalSettings(controller?: Controller) {
	try {
		const autoApprovalSettings = controller?.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		// Enable all actions
		const updatedSettings: AutoApprovalSettings = {
			...(autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS),
			actions: {
				readFiles: true,
				readFilesExternally: true,
				editFiles: true,
				editFilesExternally: true,
				executeSafeCommands: true,
				executeAllCommands: true,
				useBrowser: false, // Keep browser disabled for tests
				useMcp: false, // Keep MCP disabled for tests
			},
		}

		controller?.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)
		Logger.log("Auto approval settings updated for test mode")

		// Update the webview with the new state
		if (controller) {
			await controller.postStateToWebview()
		}
	} catch (error) {
		Logger.log(`Error updating auto approval settings: ${error}`)
	}
}

/**
 * Creates and starts an HTTP server for test automation
 * @param webviewProvider The webview provider instance to use for message catching
 * @returns The created HTTP server instance
 */
export async function createTestServer(controller: Controller): Promise<http.Server> {
	// Try to show the Cline sidebar
	Logger.log("[createTestServer] Opening Cline in sidebar...")
	vscode.commands.executeCommand(`workbench.view.${ExtensionRegistryInfo.name}-ActivityBar`)

	// Then ensure the webview is focused/loaded
	vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)

	// Update auto approval settings is available
	await updateAutoApprovalSettings(controller)

	const PORT = 9876

	testServer = http.createServer((req, res) => {
		// Set CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		// Handle shutdown request
		if (req.method === "POST" && req.url === "/shutdown") {
			res.writeHead(200)
			res.end(JSON.stringify({ success: true, message: "Server shutting down" }))

			// Shut down the server after sending the response
			setTimeout(() => {
				shutdownTestServer()
			}, 100)

			return
		}

		/**
		 * The consult seam, extension edition — the same idea as the Studio's agent-attach.
		 *
		 * /task fires a mission and runs it, but a driven run that hits an ask the auto-approval settings do
		 * not cover (a followup question, a browser launch) used to park until a human clicked in the
		 * webview. The driving agent could pre-answer everything it could predict in the task text and still
		 * be helpless the moment something new came up — it had no way to SEE the question, let alone answer.
		 *
		 * GET /ask returns the pending ask when the last message is one (type, text, partial), and
		 * {ask: null} otherwise. POST /respond answers it through controller.task.handleWebviewAskResponse —
		 * the exact handler the webview's buttons call, so an outside answer is indistinguishable from a
		 * click and shows up in the visible session the same way. The developer watching keeps priority:
		 * whoever answers first wins, identically to two clicks racing.
		 */
		// What is this run doing? The one question the seam could not answer.
		if (req.method === "GET" && req.url === "/status") {
			void (async () => {
				try {
					const task = WebviewProvider.getVisibleInstance()?.controller?.task
					const msgs = task?.messageStateHandler.getClineMessages() ?? []
					res.writeHead(200)
					res.end(
						JSON.stringify({
							state: sessionStateFrom(msgs, Boolean(task)),
							// WHICH WINDOW IS ANSWERING. Only one extension host can bind this port; every later
							// one logs EADDRINUSE and carries on regardless. So a developer can open a window on
							// the workspace they mean to drive, watch it come up clean, and have every task they
							// fire land in a different one — from outside, the seam looked identical either way.
							// [BENCH 2026-09-04] That cost a scenario two runs sitting at state:running with zero
							// API requests before anyone read the host log. A driver can now assert it is talking
							// to the right window instead of inferring it from pids and log greps, which is the
							// only version of this check that cannot quietly rot.
							workspace: await getCwd(),
							taskId: task?.taskId ?? null,
							driver: currentLease?.driver ?? null,
							ask: pendingAskFrom(msgs),
							messages: msgs.length,
							lastMessageTs: msgs.length ? Number(msgs[msgs.length - 1]?.ts ?? 0) : 0,
						}),
					)
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})()
			return
		}

		// What has this run LEARNED? Not only what it is asking.
		//
		// Without this a driver can see questions and conclusions and nothing in between, so a fact the
		// agent read off a modem — an APN, a signal level, an IP — is invisible unless it happens to be
		// mentioned in an ask. On 2026-08-29 every such fact had to be recovered by grepping the task's
		// ui_messages.json from outside.
		if (req.method === "GET" && req.url?.startsWith("/messages")) {
			void (async () => {
				try {
					const sinceTs = Number(new URL(req.url ?? "", "http://x").searchParams.get("sinceTs") ?? 0)
					const task = WebviewProvider.getVisibleInstance()?.controller?.task
					if (!task) {
						res.writeHead(200)
						res.end(JSON.stringify({ messages: [], reason: "no active task" }))
						return
					}
					const msgs = task.messageStateHandler.getClineMessages()
					res.writeHead(200)
					res.end(
						JSON.stringify({
							taskId: task.taskId,
							state: sessionStateFrom(msgs, true),
							messages: messagesSince(msgs, Number.isFinite(sinceTs) ? sinceTs : 0),
						}),
					)
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})()
			return
		}

		if (req.method === "GET" && req.url === "/ask") {
			void (async () => {
				try {
					const task = WebviewProvider.getVisibleInstance()?.controller?.task
					if (!task) {
						res.writeHead(200)
						res.end(JSON.stringify({ ask: null, reason: "no active task" }))
						return
					}
					const msgs = task.messageStateHandler.getClineMessages()
					res.writeHead(200)
					res.end(
						JSON.stringify({
							ask: pendingAskFrom(msgs),
							// `state` is the fact two drivers guessed wrong in opposite directions on
							// 2026-08-29 — see sessionStateFrom. A pending ask alone cannot tell finished
							// from stuck, and both mistakes cost real work.
							state: sessionStateFrom(msgs, true),
							messages: msgs.length,
							lastMessageTs: msgs.length ? Number(msgs[msgs.length - 1]?.ts ?? 0) : 0,
						}),
					)
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})()
			return
		}

		// Tell a running session something it did not ask about.
		if (req.method === "POST" && req.url === "/inject") {
			let noteBody = ""
			req.on("data", (chunk) => {
				noteBody += chunk.toString()
			})
			req.on("end", async () => {
				try {
					const task = WebviewProvider.getVisibleInstance()?.controller?.task
					if (!task) {
						res.writeHead(409)
						res.end(JSON.stringify({ error: "no active task" }))
						return
					}
					const pending = pendingAskFrom(task.messageStateHandler.getClineMessages())
					const check = checkInject(noteBody, pending !== null, task.noteQueue.count())
					if (!check.ok) {
						res.writeHead(check.status)
						res.end(JSON.stringify({ error: check.error, ...(pending ? { ask: pending } : {}) }))
						return
					}
					const { driver } = JSON.parse(noteBody || "{}")
					// Same queue the chat box uses, so a driver note gets the same transcript bubble and the
					// same turn-boundary delivery. The 409 above stays the seam's own rule: /respond is the
					// door while an ask is open, and it carries a ts echo that this one cannot.
					const result = await task.queueUserMessage(
						check.text,
						undefined,
						undefined,
						"seam",
						typeof driver === "string" ? driver : currentLease?.driver,
					)
					if (!result.accepted) {
						res.writeHead(result.reason === "full" ? 429 : 409)
						res.end(JSON.stringify({ error: result.reason ?? "not accepted" }))
						return
					}
					Logger.log(`Test server queued a driver note (${result.queued} waiting)`)
					res.writeHead(200)
					res.end(JSON.stringify({ ok: true, id: result.id, queued: result.queued, delivery: "next turn" }))
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})
			return
		}

		// Pick a task back up instead of starting a new one.
		//
		// Without this the only door was POST /task, so an extension-host restart meant a 600-message
		// session with real hardware state in it had to be re-briefed by hand and its context paid for
		// again. That happened three times on 2026-08-29. The resulting resume_task ask is answered
		// through /respond like any other.
		if (req.method === "POST" && req.url === "/resume") {
			let resumeBody = ""
			req.on("data", (chunk) => {
				resumeBody += chunk.toString()
			})
			req.on("end", async () => {
				try {
					const { taskId, driver, takeover } = JSON.parse(resumeBody || "{}")
					if (!taskId || typeof taskId !== "string") {
						res.writeHead(400)
						res.end(JSON.stringify({ error: "need { taskId }" }))
						return
					}
					const controller = WebviewProvider.getVisibleInstance()?.controller
					if (!controller) {
						res.writeHead(500)
						res.end(JSON.stringify({ error: "No active Adsum IoT Coder instance found" }))
						return
					}
					const live = controller.task
					const state = sessionStateFrom(live?.messageStateHandler.getClineMessages() ?? [], Boolean(live))
					const verdict = checkClaim(currentLease, state, driver, takeover === true)
					if (!verdict.ok) {
						res.writeHead(verdict.status)
						res.end(JSON.stringify(verdict))
						return
					}
					try {
						await controller.reinitExistingTaskFromId(taskId)
					} catch (e) {
						res.writeHead(404)
						res.end(JSON.stringify({ error: `no task ${taskId} in history`, detail: String(e) }))
						return
					}
					if (!controller.task) {
						res.writeHead(404)
						res.end(JSON.stringify({ error: `no task ${taskId} in history` }))
						return
					}
					currentLease = claim(driver, taskId)
					Logger.log(`Test server resumed task ${taskId} for ${currentLease.driver}`)
					res.writeHead(200)
					res.end(JSON.stringify({ success: true, taskId, resumed: true, driver: currentLease.driver }))
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})
			return
		}

		if (req.method === "POST" && req.url === "/respond") {
			let respBody = ""
			req.on("data", (chunk) => {
				respBody += chunk.toString()
			})
			req.on("end", async () => {
				try {
					const task = WebviewProvider.getVisibleInstance()?.controller?.task
					if (!task) {
						res.writeHead(409)
						res.end(JSON.stringify({ error: "no active task" }))
						return
					}
					// Every rule about WHETHER this may be delivered lives in askBridge, where it is tested;
					// this handler only carries the decision out.
					const pending = pendingAskFrom(task.messageStateHandler.getClineMessages())
					const check = checkRespond(respBody, pending)
					if (!check.ok) {
						res.writeHead(check.status)
						res.end(JSON.stringify({ error: check.error }))
						return
					}
					await task.handleWebviewAskResponse(check.responseType, check.text)
					Logger.log(
						`Test server answered ask '${pending?.kind}' with ${check.responseType}` +
							`${check.text ? `: ${check.text.slice(0, 80)}` : ""}`,
					)
					res.writeHead(200)
					res.end(JSON.stringify({ ok: true, answered: pending?.kind, ts: pending?.ts }))
				} catch (e) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: String(e) }))
				}
			})
			return
		}

		// Only handle POST requests to /task
		if (req.method !== "POST" || req.url !== "/task") {
			res.writeHead(404)
			res.end(JSON.stringify({ error: "Not found" }))
			return
		}

		// Parse the request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", async () => {
			try {
				// Parse the JSON body
				const { task, apiKey, driver, takeover } = JSON.parse(body)

				// Is someone else already driving? A collision used to be silent: the second POST simply
				// replaced the first driver's run. Now it is an answer with a name in it, and a driver who
				// means to take over says so.
				{
					const live = WebviewProvider.getVisibleInstance()?.controller?.task
					const state = sessionStateFrom(live?.messageStateHandler.getClineMessages() ?? [], Boolean(live))
					const verdict = checkClaim(currentLease, state, driver, takeover === true)
					if (!verdict.ok) {
						res.writeHead(verdict.status)
						res.end(JSON.stringify(verdict))
						return
					}
				}

				if (!task) {
					res.writeHead(400)
					res.end(JSON.stringify({ error: "Missing task parameter" }))
					return
				}

				// Get a visible webview instance
				const visibleWebview = WebviewProvider.getVisibleInstance()
				if (!visibleWebview || !visibleWebview.controller) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: "No active Cline instance found" }))
					return
				}

				// Initiate a new task
				Logger.log(`Test server initiating task: ${task}`)

				try {
					// Get and validate the workspace path
					const workspacePath = await getCwd()
					Logger.log(`Using workspace path: ${workspacePath}`)

					// Validate workspace path before proceeding with any operations
					try {
						await validateWorkspacePath(workspacePath)
					} catch (error) {
						Logger.log(`Workspace validation failed: ${error.message}`)
						res.writeHead(500)
						res.end(
							JSON.stringify({
								error: `Workspace validation failed: ${error.message}. Please open a workspace folder in VSCode before running the test.`,
								workspacePath,
							}),
						)
						return
					}

					// Initialize Git repository before starting the task
					try {
						const wasNewlyInitialized = await initializeGitRepository(workspacePath)
						if (wasNewlyInitialized) {
							Logger.log(`Initialized new Git repository in ${workspacePath} before task start`)
						} else {
							Logger.log(`Using existing Git repository in ${workspacePath} before task start`)
						}

						// Log directory contents before task start
						try {
							const { stdout: lsOutput } = await execa("ls", ["-la", workspacePath])
							Logger.log(`Directory contents before task start:\n${lsOutput}`)
						} catch (lsError) {
							Logger.log(`Warning: Failed to list directory contents: ${lsError.message}`)
						}
					} catch (gitError) {
						Logger.log(`Warning: Git initialization failed: ${gitError.message}`)
						Logger.log("Continuing without Git initialization")
					}

					// Clear any existing task
					await visibleWebview.controller.clearTask()

					// If API key is provided, update the API configuration
					if (apiKey) {
						Logger.log("API key provided, updating API configuration")

						// Get current API configuration
						const apiConfiguration = visibleWebview.controller.stateManager.getApiConfiguration()

						// Update API configuration with API key
						const updatedConfig = {
							...apiConfiguration,
							apiProvider: "cline" as ApiProvider,
							clineAccountId: apiKey,
						}

						// Store the API key securely
						visibleWebview.controller.stateManager.setSecret("clineAccountId", apiKey)

						visibleWebview.controller.stateManager.setApiConfiguration(updatedConfig)

						// Update cache service to use cline provider
						const currentConfig = visibleWebview.controller.stateManager.getApiConfiguration()
						visibleWebview.controller.stateManager.setApiConfiguration({
							...currentConfig,
							planModeApiProvider: "cline",
							actModeApiProvider: "cline",
						})

						// Post state to webview to reflect changes
						await visibleWebview.controller.postStateToWebview()
					}

					// Ensure we're in Act mode before initiating the task
					const { mode } = await visibleWebview.controller.getStateToPostToWebview()
					if (mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActMode("act")
					}

					// Initiate the new task
					const result = await visibleWebview.controller.initTask(task)

					// Try to get the task ID directly from the result or from the state
					let taskId: string | undefined

					if (typeof result === "string") {
						// If initTask returns the task ID directly
						taskId = result
					} else {
						// Wait a moment for the state to update
						await new Promise((resolve) => setTimeout(resolve, 1000))

						// Try to get the task ID from the controller's state
						const state = await visibleWebview.controller.getStateToPostToWebview()
						taskId = state.currentTaskItem?.id

						// If still not found, try polling a few times
						if (!taskId) {
							for (let i = 0; i < 5; i++) {
								await new Promise((resolve) => setTimeout(resolve, 500))
								const updatedState = await visibleWebview.controller.getStateToPostToWebview()
								taskId = updatedState.currentTaskItem?.id
								if (taskId) {
									break
								}
							}
						}
					}

					if (!taskId) {
						throw new Error("Failed to get task ID after initiating task")
					}

					Logger.log(`Task initiated with ID: ${taskId}`)

					// RETURN THE MOMENT THE TASK STARTS. Drivers poll /status.
					//
					// This used to await a "completion tracker" against a 15-minute timeout. Nothing ever
					// resolved that promise — `_taskCompletionResolver` was assigned here and called from
					// nowhere in the codebase — so every POST /task hung for the full fifteen minutes and
					// then answered `completed: false, timeout: true` about a task that had very often
					// finished. Every driver worked around it with `curl --max-time 5` and read the
					// transcript instead, which is the behaviour this now makes official.
					//
					// The metrics block that followed is gone with it: it reported on a completion that had
					// not been observed. A driver that wants them reads /status and the task history once
					// the state says complete.
					currentLease = claim(driver, String(taskId))
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, taskId, state: "running", driver: currentLease.driver }))
				} catch (error) {
					Logger.log(`Error initiating task: ${error}`)
					res.writeHead(500)
					res.end(JSON.stringify({ error: `Failed to initiate task: ${error}` }))
				}
			} catch (error) {
				res.writeHead(400)
				res.end(JSON.stringify({ error: `Invalid JSON: ${error}` }))
			}
		})
	})

	testServer.listen(PORT, () => {
		Logger.log(`Test server listening on port ${PORT}`)
	})

	// Handle server errors
	testServer.on("error", (error) => {
		Logger.log(`Test server error: ${error}`)
	})

	return testServer
}

/**
 * Shuts down the test server if it exists
 */
export function shutdownTestServer() {
	if (testServer) {
		testServer.close()
		Logger.log("Test server shut down")
		testServer = undefined
	}

	// Dispose of the message catcher if it exists
	if (messageCatcherDisposable) {
		messageCatcherDisposable.dispose()
		messageCatcherDisposable = undefined
	}
}
