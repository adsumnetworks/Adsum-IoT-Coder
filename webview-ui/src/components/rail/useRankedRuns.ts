import { type AdsumAccountState, accountHasGroup } from "@shared/adsumAccount"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DEMO_SCENARIOS } from "../chat/demoScenarios"
import { NORDIC_MODES } from "../chat/nordicModes"
import { type Ranked, rank, type Suggestable } from "../chat/welcome/suggest"
import { useEntrySignals } from "../chat/welcome/useEntrySignals"
import {
	ASK_FOR_DETAILS,
	BLG20_BOARDS,
	blg20SetUpPrompt,
	buildIntentPrompt,
	CELLULAR_BOARDS,
	CELLULAR_INTENTS,
	DEMO_HEX_PROMPT,
	DEMO_PAIR_PROMPT_BLG20,
	type IntentDef,
	isRequestOnlyGroup,
	LEW840X_BOARDS,
	NO_PROJECT_INTENTS,
	PROJECT_INTENTS,
	resolveIntentPlatform,
} from "../chat/welcome/welcomeIntents"

/** How a row acts. A run fills the composer and waits for Enter; a journey or a sample is sent as the first message. */
export type RunKind = "prefill" | "fire" | "sample" | "locked" | "open-folder"

export type RunGroup = "Runs" | "Journeys" | "Checks" | "Samples"

export interface Run extends Suggestable {
	title: string
	blurb: string
	icon: string
	kind: RunKind
	group: RunGroup
	/** The text the session starts with. Empty for "open-folder". */
	prompt: string
	/** Step count or duration, when it has one. */
	meta?: string
	/** The gate behind a locked row: register, or ask for details. */
	lockPill?: string
	/** The intent's entitlement group, for the request form. */
	entitlement?: string
	intentId?: string
	/**
	 * [0.5 the firmware lane] In the rail, this row opens the Hardware page on this firmware family instead of a
	 * session: the demo images are downloaded there, with their licence, and flashed from the folder. A session
	 * tab's palette, which cannot open a rail page, still sends the prompt.
	 */
	hardwareFamily?: string
}

export interface RankedRuns {
	/** Every run, ranked, with its reason. */
	all: Ranked<Run>[]
	/** The grounded rows the rail shows, at most three, one focal. */
	suggested: Ranked<Run>[]
	projectName?: string
}

const KIND_FOR_INTENT: Partial<Record<string, RunKind>> = { openProject: "open-folder", debug: "prefill" }
const CHECKS = new Set(["craCheck", "testValidate"])

/**
 * [0.5 sessions first] ONE catalogue, ranked ONCE, read by the Suggested block and the palette. The runs are
 * the former cards: the project intents, the partner builds, the cellular and edge-AI journeys, the demo
 * flashes, the samples. Every row carries the prompt the session will start with, so a click is a
 * prompt the developer sees, never a hidden action.
 */
export function useRankedRuns(): RankedRuns {
	const { adsumAccount, workspaceClassification } = useExtensionState() as ReturnType<typeof useExtensionState> & {
		adsumAccount?: AdsumAccountState
	}
	const { signals, scopeName } = useEntrySignals()
	return useMemo(() => {
		const platform = resolveIntentPlatform(workspaceClassification, signals.toolchains)
		const projectName = scopeName || undefined
		const intents: IntentDef[] = signals.hasWorkspace ? PROJECT_INTENTS : NO_PROJECT_INTENTS
		const fromIntents: Run[] = intents
			.filter((i) => !i.comingSoon)
			.map((i) => {
				const kind = KIND_FOR_INTENT[i.id] ?? "prefill"
				const prompt =
					i.id === "debug"
						? NORDIC_MODES.log_analyzer.systemPrompt
						: i.id === "craCheck" && !projectName
							? DEMO_SCENARIOS["cra-sample"]?.taskPrompt || ""
							: i.id === "openProject"
								? ""
								: buildIntentPrompt(i.id, projectName, platform, signals.features.hasBle)
				return {
					id: i.id,
					intentId: i.id,
					icon: i.icon,
					platform: (i.id === "craCheck" ? "both" : platform) as Run["platform"],
					title: i.title,
					blurb: i.description,
					kind: i.id === "craCheck" && !projectName ? "sample" : kind,
					group: CHECKS.has(i.id) ? "Checks" : "Runs",
					prompt,
				}
			})
		const product: Run = {
			id: "lew840xGateway",
			icon: "circuit-board",
			platform: "product",
			need: "lew840x",
			productLabel: "Fanstel LEW840x",
			otherProduct: BLG20_BOARDS,
			title: "Build the LEW840x gateway",
			blurb: "Fanstel's composable multi-radio gateway: BLE in, Ethernet, Wi-Fi or LTE out, with or without the cellular card.",
			meta: "7 steps",
			whyNeutral: "needs the gateway, its UART bridge board and a Nordic DK as probe",
			needsAlso: "the LEW840x gateway, its UART bridge board and a DK as probe",
			kind: "fire",
			group: "Journeys",
			prompt: "Build the LEW840x gateway: scan BLE tags and publish them to MQTT over Ethernet, Wi-Fi and LTE",
		}
		const cellular: Run[] = CELLULAR_INTENTS.map((i) => {
			const locked = !!i.group && !accountHasGroup(adsumAccount, i.group)
			const blg20Unit = signals.nrfBoards.find((b) => BLG20_BOARDS.test(b))
			const prompt =
				i.id === "blg20Gateway" && blg20Unit
					? blg20SetUpPrompt(blg20Unit)
					: buildIntentPrompt(i.id, projectName, platform, signals.features.hasBle)
			return {
				id: i.id,
				intentId: i.id,
				icon: i.icon,
				platform: "product",
				need: i.id === "blg20Gateway" ? "blg20" : "cellular",
				productLabel: i.id === "blg20Gateway" ? "Fanstel BLG20x" : undefined,
				boardMatch:
					i.id === "blg20Gateway" ? BLG20_BOARDS : i.id === "cellularGateway" ? LEW840X_BOARDS : CELLULAR_BOARDS,
				otherProduct: i.id === "blg20Gateway" ? LEW840X_BOARDS : BLG20_BOARDS,
				whyNeutral:
					i.id === "edgeAi" ? "needs an nRF54 with the Axon NPU" : "needs an nRF91-family board or a Fanstel gateway",
				needsAlso: i.needsAlso,
				title: i.id === "blg20Gateway" && blg20Unit ? `Set up ${blg20Unit}` : i.title,
				blurb:
					i.id === "blg20Gateway" && blg20Unit
						? "Read the unit, claim it when asked, offer the update, then commission it over the cable"
						: i.description,
				locked,
				lockPill: locked ? (adsumAccount || isRequestOnlyGroup(i.group) ? ASK_FOR_DETAILS : "Register") : undefined,
				entitlement: i.group,
				kind: locked ? "locked" : "fire",
				group: "Journeys",
				prompt,
			}
		})
		const demos: Run[] = [
			{
				id: "demoHex",
				icon: "rocket",
				platform: "product",
				need: "lew840x",
				productLabel: "Fanstel LEW840x",
				otherProduct: BLG20_BOARDS,
				whyNeutral: "needs the LEW840x and its programming kit; nrfutil and esptool on this machine",
				needsAlso: "the LEW840x programming kit, with nrfutil and esptool on this machine",
				title: "Flash the LEW840x demo",
				blurb: "Three signed hexes: BLE scanner, ESP32 uplink, nRF9160 bearer. About three minutes.",
				meta: "≈ 3 min",
				kind: accountHasGroup(adsumAccount, "lew840x-demo-hex") ? "prefill" : "locked",
				lockPill: accountHasGroup(adsumAccount, "lew840x-demo-hex")
					? undefined
					: adsumAccount
						? ASK_FOR_DETAILS
						: "Register",
				entitlement: "lew840x-demo-hex",
				group: "Journeys",
				prompt: DEMO_HEX_PROMPT,
				hardwareFamily: "lew840x",
			},
			{
				id: "demoPairBlg20",
				icon: "rocket",
				platform: "product",
				need: "blg20",
				productLabel: "Fanstel BLG20x",
				boardMatch: BLG20_BOARDS,
				otherProduct: LEW840X_BOARDS,
				whyNeutral: "needs the BLG20x and its two probes",
				title: "Flash the BLG20x demo pair",
				blurb: "The demo images for both halves, checked against their hashes before anything is written.",
				kind: accountHasGroup(adsumAccount, "blg20-demo-hex") ? "prefill" : "locked",
				lockPill: accountHasGroup(adsumAccount, "blg20-demo-hex")
					? undefined
					: adsumAccount
						? ASK_FOR_DETAILS
						: "Register",
				entitlement: "blg20-demo-hex",
				group: "Journeys",
				prompt: DEMO_PAIR_PROMPT_BLG20,
				hardwareFamily: "blg20x",
			},
		]
		const samples: Run[] = Object.values(DEMO_SCENARIOS).map((d) => ({
			id: `sample:${d.id}`,
			icon: "play",
			platform: "both",
			title: d.title,
			blurb: d.honestLabel,
			meta: "about a minute · nothing to install",
			kind: "sample",
			group: "Samples",
			prompt: d.taskPrompt,
		}))
		const all = rank<Run>([product, ...fromIntents, ...cellular, ...demos, ...samples], signals)
		// Suggested: grounded rows only, at most three; the first is the focal one.
		const suggested = all.filter((r) => r.grounded && r.item.kind !== "open-folder").slice(0, 3)
		return { all, suggested, projectName }
	}, [adsumAccount, workspaceClassification, signals, scopeName])
}
