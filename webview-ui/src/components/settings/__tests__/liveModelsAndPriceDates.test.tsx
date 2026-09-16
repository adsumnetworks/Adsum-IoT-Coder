import { deepSeekModels } from "@shared/api"
import { PRICES_CHECKED_AT, UNKNOWN_MODEL_INFO, withoutRetired } from "@shared/liveModels"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { liveModelsFor, resetLiveModels, setLiveModels } from "../utils/liveModelStore"
import { getModelsForProvider, normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * What a developer sees for a direct provider: the models it serves now, and how old the price shown is.
 * [OPERATOR 2026-09-14] a renamed DeepSeek model stayed on offer under its old id, and prices went stale
 * without anything on screen saying so.
 */

afterEach(() => resetLiveModels())

describe("the price date next to the price", () => {
	it("a dated price renders its date", () => {
		render(
			<ModelInfoView
				modelInfo={deepSeekModels["deepseek-v4-pro"]}
				pricesCheckedAt={PRICES_CHECKED_AT.deepseek}
				selectedModelId="deepseek-v4-pro"
			/>,
		)
		expect(screen.getByTestId("prices-checked").textContent).toBe("Prices checked 16 Sep 2026")
	})

	it("a model the price list does not cover says so instead of showing a date that does not apply", () => {
		render(
			<ModelInfoView
				modelInfo={UNKNOWN_MODEL_INFO}
				pricesCheckedAt="2026-09-04"
				selectedModelId="deepseek-something-unreleased"
			/>,
		)
		expect(screen.queryByTestId("prices-checked")).toBeNull()
		expect(screen.getByTestId("prices-unknown").textContent).toContain("not in our price list yet")
	})

	it("live prices say where they came from, and a provider with neither says nothing new", () => {
		const { unmount } = render(
			<ModelInfoView
				livePricesFrom="OpenRouter"
				modelInfo={{ supportsPromptCache: false, inputPrice: 1 }}
				selectedModelId="x"
			/>,
		)
		expect(screen.getByTestId("prices-live").textContent).toBe("Live prices from OpenRouter")
		unmount()
		render(<ModelInfoView modelInfo={{ supportsPromptCache: false, inputPrice: 1 }} selectedModelId="x" />)
		expect(screen.queryByTestId("prices-live")).toBeNull()
		expect(screen.queryByTestId("prices-checked")).toBeNull()
		expect(screen.queryByTestId("prices-unknown")).toBeNull()
	})
})

describe("the live list in the webview", () => {
	const served = { "deepseek-v4-pro": { ...deepSeekModels["deepseek-v4-pro"] }, "deepseek-flash": { ...UNKNOWN_MODEL_INFO } }

	it("shows the shipped list until the extension answers, then the served one", () => {
		// The shipped list, less the ids DeepSeek has retired — those are never offered, even before an answer.
		expect(getModelsForProvider("deepseek")).toEqual(withoutRetired("deepseek", deepSeekModels))
		setLiveModels("deepseek", deepSeekModels, served)
		expect(Object.keys(getModelsForProvider("deepseek") ?? {})).toEqual(["deepseek-v4-pro", "deepseek-flash"])
		// Shipped info is kept for known ids (full fidelity), not the copy that crossed the wire.
		expect(liveModelsFor("deepseek", deepSeekModels)["deepseek-v4-pro"]).toBe(deepSeekModels["deepseek-v4-pro"])
	})

	it("an empty answer keeps the shipped list", () => {
		setLiveModels("deepseek", deepSeekModels, {})
		// The shipped list, less the ids DeepSeek has retired — those are never offered, even before an answer.
		expect(getModelsForProvider("deepseek")).toEqual(withoutRetired("deepseek", deepSeekModels))
	})

	it("a served id the table does not know stays selected; a stray id from another provider does not", () => {
		setLiveModels("deepseek", deepSeekModels, served)
		const chosen = normalizeApiConfiguration(
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-flash" } as never,
			"act",
		)
		expect(chosen.selectedModelId).toBe("deepseek-flash")
		const stray = normalizeApiConfiguration(
			{ actModeApiProvider: "deepseek", actModeApiModelId: "claude-sonnet-5" } as never,
			"act",
		)
		expect(stray.selectedModelId).toBe("deepseek-v4-pro")
	})

	it("a retired id still saved in settings is shown plainly as no longer offered", () => {
		setLiveModels("deepseek", deepSeekModels, served)
		render(
			<ModelSelector
				flagUnlisted
				models={getModelsForProvider("deepseek") ?? {}}
				onChange={() => {}}
				selectedModelId="deepseek-v4-flash"
			/>,
		)
		expect(screen.getByTestId("model-no-longer-offered").textContent).toContain("deepseek-v4-flash")
	})

	it("other lists are not flagged, since they can be momentarily incomplete", () => {
		render(<ModelSelector models={{}} onChange={() => {}} selectedModelId="some-model" />)
		expect(screen.queryByTestId("model-no-longer-offered")).toBeNull()
	})
})
