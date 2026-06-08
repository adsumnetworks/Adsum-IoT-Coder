import * as vscode from "vscode"
import {
	cleanupMcpMarketplaceCatalogFromGlobalState,
	migrateCustomInstructionsToGlobalRules,
	migrateHooksEnabledToBoolean,
	migrateTaskHistoryToFile,
	migrateWelcomeViewCompleted,
	migrateWorkspaceToGlobalStorage,
} from "./core/storage/state-migrations"
import { WebviewProvider } from "./core/webview"
import { Logger } from "./services/logging/Logger"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { HostProvider } from "@/hosts/host-provider"
import { FileContextTracker } from "./core/context/context-tracking/FileContextTracker"
import { initDemoManager } from "./core/demos/DemoManager"
import { StateManager } from "./core/storage/StateManager"
import { openAiCodexOAuthManager } from "./integrations/openai-codex/oauth"
import { ExtensionRegistryInfo } from "./registry"
import { loadCachedQuota, registerInstallIfNeeded } from "./services/adsum/FreeTierService"
import { initFreeTierPersistence, setFreeTierActive } from "./services/adsum/FreeTierState"
import { initializeInstallId } from "./services/adsum/InstallIdentity"
import { maybeShowReengagementNudge } from "./services/adsum/ReengagementNudge"
import { BannerService } from "./services/banner/BannerService"
import { audioRecordingService } from "./services/dictation/AudioRecordingService"
import { ErrorService } from "./services/error"
import { featureFlagsService } from "./services/feature-flags"
import { getDistinctId, initializeDistinctId, setDistinctId } from "./services/logging/distinctId"
import { telemetryService } from "./services/telemetry"
import { PostHogClientProvider } from "./services/telemetry/providers/posthog/PostHogClientProvider"
import { ShowMessageType } from "./shared/proto/host/window"
import { FeatureFlag } from "./shared/services/feature-flags/feature-flags"
import { syncWorker } from "./shared/services/worker/sync"
import { getBlobStoreSettingsFromEnv } from "./shared/services/worker/worker"
import { getLatestAnnouncementId } from "./utils/announcements"
import { arePathsEqual } from "./utils/path"
/**
 * Performs intialization for Cline that is common to all platforms.
 *
 * @param context
 * @returns The webview provider
 */
export async function initialize(context: vscode.ExtensionContext): Promise<WebviewProvider> {
	try {
		await StateManager.initialize(context)
	} catch (error) {
		console.error("[Controller] CRITICAL: Failed to initialize StateManager - extension may not function properly:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to initialize Adsum IoT Coder's application state. Please restart the extension.",
		})
	}

	// Initialize OpenAI Codex OAuth manager with extension context for secrets storage
	openAiCodexOAuthManager.initialize(context)

	// Set the distinct ID for logging and telemetry
	await initializeDistinctId(context)

	// Initialize stable anonymous install ID for Adsum free-tier proxy
	const installId = await initializeInstallId(context)

	// Unify the telemetry/feature-flag person key on the Adsum install_id so the host
	// client funnel joins the backend's install_id person-space in PostHog. Host events
	// were previously keyed by machineId (with install_id only as an event property),
	// which made the install→demo→activation funnel unjoinable across client and backend.
	// free-tier-stage0 is the only feature flag and is a 100% rollout, so re-keying does
	// not change flag eligibility. On Cline sign-in, identifyUser() switches to the
	// account id (recording install_id as an alias property), preserving that path.
	setDistinctId(installId)

	// Seed the in-memory quota cache from last-persisted value so the chip
	// shows before the first API response on every launch (not just first registration)
	loadCachedQuota(context.globalState)

	// Gate all token display on whether the user is actually on the free tier.
	// Reads the persisted provider so the status bar and FreeTierStrip show
	// nothing when the user has switched to their own key (BYOK).
	const activeProvider = context.globalState.get("actModeApiProvider")
	setFreeTierActive(activeProvider === "adsum-free")

	// Capture globalState so the free-tier handler can persist its once-ever
	// first-run funnel flag across restarts
	initFreeTierPersistence(context.globalState)
	initDemoManager(context.extensionPath, context.globalStorageUri.fsPath)

	// Initialize PostHog client provider
	PostHogClientProvider.getInstance()

	// Setup the external services
	await ErrorService.initialize()
	// Bound the feature-flags network poll (up to ~10 sequential PostHog round-trips)
	// so a slow or unreachable endpoint can't block activation — and therefore the
	// sidebar view registration — indefinitely. This was the cause of the
	// "panel loads forever until you reload the window" bug. The poll keeps running
	// in the background and populates the flag cache whenever it completes. Mirrors
	// the registerInstallIfNeeded race guard a few lines below.
	await Promise.race([featureFlagsService.poll(null), new Promise<void>((resolve) => setTimeout(resolve, 3000))]).catch(
		() => {},
	)

	// Register this install with the Adsum free-tier proxy (idempotent upsert).
	// Awaited with a 3s timeout so quota is in FreeTierState before postStateToWebview fires.
	await Promise.race([
		registerInstallIfNeeded(context.globalState),
		new Promise<void>((resolve) => setTimeout(resolve, 3000)),
	]).catch(() => {})

	// One-time: set welcomeViewCompleted from existing API keys. Runs BEFORE the free-tier default
	// below so that block can use welcomeViewCompleted as the "user already configured real
	// inference" signal (migrate sets it true iff a real key/account exists).
	await migrateWelcomeViewCompleted(context)

	// Default fresh, unconfigured installs to the free tier (Stage 0) and skip the model-select
	// gate so they land on the demo. The provider enum is NOT a reliable "configured" signal:
	// state-helpers computes a default ("openrouter") during StateManager.initialize(), before the
	// flag cache is warm, so a brand-new install already reads planModeApiProvider="openrouter".
	// Key off welcomeViewCompleted instead (false here = no real key, per migrate just above).
	// The flag cache is warm by now (featureFlagsService.poll() ran above).
	try {
		const freeTierEnabled = featureFlagsService.getBooleanFlagEnabled(FeatureFlag.FREE_TIER_STAGE0)
		const alreadyConfigured = !!context.globalState.get("welcomeViewCompleted")
		if (freeTierEnabled && !alreadyConfigured) {
			const stateManager = StateManager.get()
			stateManager.setGlobalState("planModeApiProvider", "adsum-free")
			stateManager.setGlobalState("actModeApiProvider", "adsum-free")
			stateManager.setGlobalState("welcomeViewCompleted", true)
			// Write-through to raw globalState so the StateManager cache (read by the webview) and
			// the next launch stay consistent.
			await context.globalState.update("welcomeViewCompleted", true)
			console.log("[adsum] fresh install defaulted to free tier + model-select gate skipped")
		}
	} catch (err) {
		console.warn("[adsum] free-tier default check failed:", err)
	}

	// Migrate custom instructions to global Cline rules (one-time cleanup)
	await migrateCustomInstructionsToGlobalRules(context)

	// Migrate workspace storage values back to global storage (reverting previous migration)
	await migrateWorkspaceToGlobalStorage(context)

	// Ensure taskHistory.json exists and migrate legacy state (runs once)
	await migrateTaskHistoryToFile(context)

	// Migrate hooksEnabled from ClineFeatureSetting to boolean (one-time cleanup)
	await migrateHooksEnabledToBoolean(context)

	// Clean up MCP marketplace catalog from global state (moved to disk cache)
	await cleanupMcpMarketplaceCatalogFromGlobalState(context)

	// Clean up orphaned file context warnings (startup cleanup)
	await FileContextTracker.cleanupOrphanedWarnings(context)

	const webview = HostProvider.get().createWebviewProvider()

	await showVersionUpdateAnnouncement(context)
	await maybeShowReengagementNudge()

	// Check if this workspace was opened from worktree quick launch
	await checkWorktreeAutoOpen(context)

	// Reveal Adsum sidebar if this window was opened via the "Open my nRF project" card
	await checkAdsumRevealAfterOpen(context)

	// Initialize banner service (TEMPORARILY DISABLED - not fetching banners to prevent API hammering)
	BannerService.initialize(webview.controller)
	// DISABLED: .getActiveBanners(true)

	telemetryService.captureExtensionActivated()

	// Use remote config blobStoreConfig if available, otherwise fall back to env vars
	const blobStoreSettings = StateManager.get().getRemoteConfigSettings()?.blobStoreConfig ?? getBlobStoreSettingsFromEnv()
	syncWorker().init({ ...blobStoreSettings, userDistinctId: getDistinctId() })

	return webview
}

async function showVersionUpdateAnnouncement(context: vscode.ExtensionContext) {
	// Version checking for autoupdate notification
	const currentVersion = ExtensionRegistryInfo.version
	const previousVersion = context.globalState.get<string>("nrfAiDebuggerVersion")
	// Perform post-update actions if necessary
	try {
		if (!previousVersion || currentVersion !== previousVersion) {
			Logger.log(`Adsum IoT Coder version changed: ${previousVersion} -> ${currentVersion}. First run or update detected.`)

			// First-ever activation on this machine — fire the unique-install
			// telemetry event exactly once so PostHog can distinguish installs
			// from session activations.
			if (!previousVersion) {
				telemetryService.captureExtensionInstalled()
			}

			// Check if there's a new announcement to show
			const lastShownAnnouncementId = context.globalState.get<string>("lastShownAnnouncementId")
			const latestAnnouncementId = getLatestAnnouncementId()

			if (lastShownAnnouncementId !== latestAnnouncementId) {
				const isNewInstall = !previousVersion
				const message = isNewInstall
					? `Welcome to Adsum IoT Coder v${currentVersion}`
					: `Adsum IoT Coder has been updated to v${currentVersion}`
				const cta = isNewInstall ? "🚀 See it debug a real bug (30s)" : "🚀 What's new — see it"
				// Fire-and-forget: do NOT await the toast. showMessage resolves only when the user
				// clicks or dismisses it, and this function is awaited in activate() — awaiting here
				// would block activation (and the version-tracker write below) until the user reacts.
				void HostProvider.window
					.showMessage({
						type: ShowMessageType.INFORMATION,
						message,
						options: { items: [cta] },
					})
					.then(({ selectedOption }) => {
						if (selectedOption === cta) {
							// Queue the demo to auto-start, then reveal the sidebar. The webview's
							// ChatView consumes demoAutoStart and runs it via handleStartDemo (only if
							// no task is active); newTask clears the flag when the demo task fires.
							StateManager.get().setGlobalState("demoAutoStart", "nus-uart")
							void HostProvider.workspace.openClineSidebarPanel({})
						}
					})
					.catch(() => {})
			}
			// Always update the main version tracker for the next launch.
			await context.globalState.update("nrfAiDebuggerVersion", currentVersion)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Error during post-update actions: ${errorMessage}, Stack trace: ${error.stack}`)
	}
}

/**
 * Checks if this workspace was opened from the worktree quick launch button.
 * If so, opens the Cline sidebar and clears the state.
 */
async function checkWorktreeAutoOpen(context: vscode.ExtensionContext): Promise<void> {
	try {
		// Read directly from globalState (not StateManager cache) since this may have been
		// set by another window right before this one opened
		const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		// Get current workspace path
		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
		if (workspacePaths.length === 0) {
			return
		}

		const currentPath = workspacePaths[0]

		// Check if current workspace matches the worktree path
		if (arePathsEqual(currentPath, worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			await context.globalState.update("worktreeAutoOpenPath", undefined)
			// Open the Cline sidebar
			await HostProvider.workspace.openClineSidebarPanel({})
		}
	} catch (error) {
		Logger.error("Error checking worktree auto-open", error)
	}
}

/**
 * Reveals the Adsum sidebar if the window was opened via the "Open my nRF project" card.
 * Mirrors checkWorktreeAutoOpen — reads the flag set by openFolder.ts before the window reload.
 */
async function checkAdsumRevealAfterOpen(context: vscode.ExtensionContext): Promise<void> {
	try {
		const { ADSUM_REVEAL_SIDEBAR_KEY } = await import("./core/controller/file/openFolder")
		const revealPath = context.globalState.get<string>(ADSUM_REVEAL_SIDEBAR_KEY)
		if (!revealPath) {
			return
		}

		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
		if (workspacePaths.length === 0) {
			return
		}

		if (arePathsEqual(workspacePaths[0], revealPath)) {
			await context.globalState.update(ADSUM_REVEAL_SIDEBAR_KEY, undefined)
			await HostProvider.workspace.openClineSidebarPanel({})
		}
	} catch (error) {
		Logger.error("Error checking Adsum reveal after open", error)
	}
}

/**
 * Performs cleanup when Cline is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	// Clean up audio recording service to ensure no orphaned processes
	audioRecordingService.cleanup()

	PostHogClientProvider.getInstance().dispose()
	telemetryService.dispose()
	ErrorService.get().dispose()
	featureFlagsService.dispose()
	// Dispose all webview instances
	await WebviewProvider.disposeAllInstances()
	syncWorker().dispose()
}
