import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { KbitLockedRow } from "../../KbitLockedRow"
import DemoHexCard from "../DemoHexCard"
import GatewayLadder, { LADDER_COPY, ladderChipPair } from "../GatewayLadder"
import { CELLULAR_INTENTS } from "../welcomeIntents"

/**
 * The three falsifiers for the BLG20x store surfaces.
 *
 * Each one is the sentence that would have caught the thing the review found, and each fails loudly
 * if that thing comes back: an owner of the second board seeing nothing where their demo should be;
 * a set a person opens by hand offering a sign-up that cannot open it; and the one door acquiring a
 * second name somewhere in the tree.
 */

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	AdsumServiceClient: { requestAccess: async () => ({ value: "{}" }) },
	StateServiceClient: { captureEntryEvent: () => ({ catch: () => {} }) },
}))

const account = (groups: string[]) => ({
	adsumAccount: { email: "dev@example.com", name: "Dev", emailVerified: true, groups },
})

beforeEach(() => {
	state.current = {}
})

describe("BLG20x store bits — falsifiers", () => {
	it("F1 a BLG20x owner sees their pair, with the limits above the action and what protects it", () => {
		state.current = account(["blg20-demo-hex"])
		render(<DemoHexCard onFlash={vi.fn()} />)
		const card = screen.getByTestId("demo-pair-card-blg20")
		expect(card.textContent).toContain("BLG20x demo pair")
		// Both limits, and BEFORE the action in document order — stated, not discovered.
		const limits = screen.getByTestId("demo-limits")
		expect(limits.textContent).toContain("Limited use for demos")
		expect(limits.textContent).toContain("Terrestrial and satellite")
		expect(
			limits.compareDocumentPosition(screen.getByTestId("demo-hex-flash")) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		expect(screen.getByTestId("demo-hex-flash").textContent).toBe("Install into this project")
		// The protection sentence, in the developer's words and verbatim.
		expect(screen.getByTestId("demo-protection").textContent).toContain(
			"Today the demo image is protected by your account's access and a usage cap built into the image, " +
				"nothing more. The production image is protected by account access only.",
		)
		// And the other board's demo is not what they were handed.
		expect(card.textContent).not.toContain("LEW840x")
		expect(card.textContent).not.toContain("60-minute")
	})

	it("F2 a by-request set never offers Register — it offers the one action, and it opens", () => {
		const onRequestAccess = vi.fn()
		const onRegister = vi.fn()
		state.current = account(["cellular-advanced"])
		render(
			<KbitLockedRow
				bit={{ id: "adv-full", title: "The advanced set — the whole board", group: "blg20-adv-full" }}
				onRegister={onRegister}
				onRequestAccess={onRequestAccess}
			/>,
		)
		const row = screen.getByTestId("kbit-locked-row")
		expect(row.textContent).not.toContain("Register")
		expect(row.textContent).not.toContain("needs a registered account")
		expect(row.textContent).toContain("available on request")
		fireEvent.click(screen.getByTestId("kbit-locked-request"))
		expect(onRequestAccess).toHaveBeenCalledTimes(1)
		expect(onRegister).not.toHaveBeenCalled()

		// The set registering DOES open keeps the register door, or nobody would ever find it.
		state.current = {}
		render(
			<KbitLockedRow
				bit={{ id: "nrf91", title: "nRF91 modem bring-up", group: "cellular-advanced" }}
				onRegister={onRegister}
			/>,
		)
		expect(screen.getByTestId("kbit-locked-register").textContent).toBe("Register")
	})

	it("F3 the one door has one name, and no surface says how the inside works", () => {
		const src = join(process.cwd(), "src", "components", "chat")
		const files = [
			join(src, "welcome", "CellularGroup.tsx"),
			join(src, "welcome", "RequestAccessForm.tsx"),
			join(src, "welcome", "DemoHexCard.tsx"),
			join(src, "welcome", "UnlockedCard.tsx"),
			join(src, "KbitLockedRow.tsx"),
			// The drawer is the same cards on a second surface — it was missed once, so it is linted.
			join(src, "welcome", "WelcomeView.tsx"),
			join(src, "welcome", "EntryDrawer.tsx"),
		]
		for (const file of files) {
			// Only what a developer can READ: the strings, not our comments about them.
			const text = readFileSync(file, "utf8")
				.split("\n")
				.filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
				.join("\n")
			for (const banned of ["Request access", "Request template source", "Step 2", "registry gate", "steward", "seed"]) {
				expect(text, `${file} still says "${banned}"`).not.toContain(banned)
			}
		}
	})

	it("F6 the ladder is ONE card with exactly three rungs, and only for this board", () => {
		state.current = account(["blg20-demo-hex", "blg20-early-access"])
		const onAsk = vi.fn()
		const { container, unmount } = render(
			<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={onAsk} onInstall={vi.fn()} onStart={vi.fn()} />,
		)
		const card = screen.getByTestId("gateway-ladder")
		expect(screen.getByTestId("ladder-board").textContent).toBe("Fanstel BLG20XE02C")
		// Nothing counts probes yet, so the card claims nothing about them.
		expect(card.textContent).not.toMatch(/probe/i)

		// Exactly three rungs, inside ONE card — never three cards.
		const rungs = [...card.querySelectorAll("[data-testid^='ladder-rung-']")].filter(
			(el) => !(el.getAttribute("data-testid") ?? "").endsWith("-badge"),
		)
		expect(rungs).toHaveLength(3)
		expect(container.querySelectorAll("[data-testid='gateway-ladder']")).toHaveLength(1)

		// No price, and no licence term. The rungs say which way, never what it costs or what it grants.
		// Word boundaries on the licence names, or "Li-MIT-ed use for demos" fails a copy that is fine.
		expect(card.textContent).not.toMatch(
			/[€$£]|\bEUR\b|\bUSD\b|per unit|royalt|perpetual|non-exclusive|\bMIT\b|\bApache\b|\bGPL\b/i,
		)
		// Tier words only.
		expect(screen.getByTestId("ladder-rung-build-badge").textContent).toBe("Free")

		// Every way that is not already theirs offers the one action, and only that.
		for (const [way, testId] of [
			["ladder-way-production", "ladder-ask-prod"],
			["ladder-way-source", "ladder-ask-source"],
		] as const) {
			const buttons = [...screen.getByTestId(way).querySelectorAll("button")]
			expect(buttons).toHaveLength(1)
			expect(buttons[0].textContent).toBe("Ask for more details")
			fireEvent.click(screen.getByTestId(testId))
		}
		expect(onAsk).toHaveBeenCalledTimes(2)
		// The demo IS theirs, so it offers the doing action rather than an ask.
		expect(screen.getByTestId("ladder-flash-demo").textContent).toBe("Install into this project")
		unmount()

		// An unrelated board gets no ladder — a surface that names a board must have seen one.
		state.current = account(["blg20-demo-hex"])
		const { container: other } = render(
			<GatewayLadder boards={["nRF52840 DK"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />,
		)
		expect(other.querySelector("[data-testid='gateway-ladder']")).toBeNull()
	})

	it("F7 a run row is titled by what it does, and names its own gap", () => {
		const blg20 = CELLULAR_INTENTS.find((i) => i.id === "blg20Gateway")
		// Part numbers belong one line down, not in the title a developer scans.
		expect(blg20?.title).not.toMatch(/nRF\d|BLG20Bx|LBG20Bx|IP5\d|IP6\d|02C/)
		expect((blg20?.title ?? "").length).toBeLessThanOrEqual(60)
		// And every product row can say what IT still needs — no shared sentence to fall back on.
		const gaps = CELLULAR_INTENTS.map((i) => i.needsAlso)
		expect(gaps.every(Boolean)).toBe(true)
		expect(new Set(gaps).size).toBe(gaps.length)
	})

	it("F8 the partner account is offered its demo and asked to ask for everything else", () => {
		// The first real customer: the demo pair and the advanced knowledge for this board, nothing more.
		state.current = account([
			"cellular-advanced",
			"edge-ai-advanced",
			"lew840x-demo-hex",
			"blg20-demo-hex",
			"blg20-adv-ble",
			"blg20-adv-full",
		])
		render(<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />)
		const card = screen.getByTestId("gateway-ladder")

		// The one thing they hold offers the doing action.
		expect(screen.getByTestId("ladder-flash-demo").textContent).toBe("Install into this project")

		// The two they do not hold offer ONE control each, and it is the ask.
		for (const way of ["ladder-way-production", "ladder-way-source"] as const) {
			const buttons = [...screen.getByTestId(way).querySelectorAll("button")]
			expect(buttons, `${way} must offer exactly one control`).toHaveLength(1)
			expect(buttons[0].textContent).toBe("Ask for more details")
			// And never a doing action dressed as a link.
			expect(screen.getByTestId(way).textContent).not.toMatch(
				/install|flash|download|clone|check ?out|open the (source|repo)|unlock/i,
			)
		}

		// Nothing on the card says a source or production artefact is theirs, or nearly theirs.
		expect(card.textContent).not.toMatch(
			/source is yours|yours to (build|ship)|already (included|yours)|coming to your account|almost|trial of the source|free with/i,
		)
		// Ownership is shown, not claimed: the badge and the doing action say it, and no prose does.
		expect(screen.getByTestId("ladder-rung-license-badge").textContent).toBe("Demo included")
		expect(card.textContent).not.toMatch(/\byours\b/i)

		// Still no price and no licence term for this account either.
		expect(card.textContent).not.toMatch(
			/[€$£]|\bEUR\b|\bUSD\b|per unit|royalt|perpetual|non-exclusive|\bMIT\b|\bApache\b|\bGPL\b/i,
		)
	})

	it("F9 the card never says a way is yours to an account that does not hold it", () => {
		// Registered, but this board's demo pair is granted per account and this one has not been.
		state.current = account(["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"])
		const { unmount } = render(
			<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />,
		)
		const card = screen.getByTestId("gateway-ladder")
		expect(card.textContent).not.toMatch(/\byours\b|already (yours|included)/i)
		expect(screen.getByTestId("ladder-rung-license-badge").textContent).toBe("Licensed")
		// Every way is an ask, and there is no doing action anywhere on the card except starting the free path.
		expect(screen.queryByTestId("ladder-flash-demo")).toBeNull()
		expect(screen.getByTestId("ladder-ask-demo").textContent).toBe("Ask for more details")
		unmount()

		// And the account that DOES hold it is told so, in the badge and in the line.
		state.current = account(["blg20-demo-hex"])
		render(<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />)
		expect(screen.getByTestId("ladder-rung-license-badge").textContent).toBe("Demo included")
		// The doing action is the ownership signal now, not a sentence about it.
		expect(screen.getByTestId("ladder-flash-demo").textContent).toBe("Install into this project")
	})

	it("F10 no rung says more than a developer can take in at a glance", () => {
		/*
		 * 60 characters, calibrated against the rendered heights and not guessed: at 269 px the body
		 * column is about 200 px, roughly 30 characters of the 12 px face, so two lines is 60. The
		 * first pass used 88 and the shooting script's measurement caught a body rendering FOUR lines
		 * at that width — which is why the number comes from the render, and the render check stays in
		 * the shooting script (jsdom does no layout).
		 */
		const TWO_LINES = 60
		for (const [key, line] of Object.entries(LADDER_COPY)) {
			assert_length(key, line, TWO_LINES)
		}
		// And the card as a whole: one screen, not an essay.
		state.current = account(["blg20-demo-hex"])
		render(<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />)
		const words = (screen.getByTestId("gateway-ladder").textContent ?? "").split(/\s+/).filter(Boolean).length
		expect(words, `the whole card is ${words} words`).toBeLessThanOrEqual(120)

		// The words that carry a commitment are still there.
		const card = screen.getByTestId("gateway-ladder").textContent ?? ""
		for (const kept of ["Free", "Limited use for demos", "Ask for more details", "We reply within a business day"]) {
			expect(card, `"${kept}" is load-bearing and must survive the cut`).toContain(kept)
		}
	})

	it("F11 every rung reads what the account holds, and two different accounts are two different cards", () => {
		const ladder = (groups: string[]) => {
			state.current = account(groups)
			const { unmount } = render(
				<GatewayLadder boards={["Fanstel BLG20XE02C"]} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />,
			)
			const text = screen.getByTestId("gateway-ladder").textContent ?? ""
			const ids = [...screen.getByTestId("gateway-ladder").querySelectorAll("[data-testid]")].map((e) =>
				e.getAttribute("data-testid"),
			)
			unmount()
			return { text, ids }
		}

		// The partner: demo and both advanced sets, no production, no source.
		const partner = ladder(["blg20-demo-hex", "blg20-adv-ble", "blg20-adv-full"])
		expect(partner.ids).toContain("ladder-flash-demo")
		expect(partner.ids).toContain("ladder-ask-prod")
		expect(partner.ids).toContain("ladder-ask-source")
		expect(partner.ids).not.toContain("ladder-use-prod")
		expect(partner.ids).not.toContain("ladder-use-source")
		// Holding the advanced sets, they are not invited to ask for them — the line is simply gone.
		expect(partner.ids).not.toContain("ladder-advanced-line")
		expect(partner.text).not.toContain("Advanced set: on request")

		// A production licence holder does the thing rather than asking about it.
		const production = ladder(["blg20-demo-hex", "blg20-prod-hex"])
		expect(production.ids).toContain("ladder-use-prod")
		expect(production.ids).not.toContain("ladder-ask-prod")

		// One half of the source is not both halves, and the words say which.
		const radioHalf = ladder(["blg20-9151-src"])
		expect(radioHalf.text).toContain("· the radio half")
		expect(radioHalf.ids).toContain("ladder-use-source")
		expect(radioHalf.ids).toContain("ladder-ask-source")
		const bleHalf = ladder(["blg20-ble-src"])
		expect(bleHalf.text).toContain("· the BLE half")
		const bothHalves = ladder(["blg20-ble-src", "blg20-9151-src"])
		// Both halves: the heading names them and the body says what arrives.
		expect(bothHalves.text).toContain("· both halves")
		expect(bothHalves.text).toContain("Generated into your project, never a repository.")
		// One line for what arrives, whichever halves — the heading carries which.
		expect(radioHalf.text).toContain("Generated into your project, never a repository.")
		expect(bothHalves.ids).not.toContain("ladder-ask-source")

		// And the defect that started this: two accounts, two cards.
		const everything = ladder(["all"])
		expect(everything.ids).toContain("ladder-use-prod")
		expect(everything.ids).toContain("ladder-use-source")
		expect(partner.text).not.toEqual(everything.text)
		expect(ladder([]).text).not.toEqual(partner.text)
	})

	it("F13 the board is recognised by the pair of chips, and never by one of them", () => {
		state.current = account(["blg20-demo-hex"])
		const render1 = (chips: string[]) => {
			const { container, unmount } = render(
				<GatewayLadder boards={[]} chips={chips} onAsk={vi.fn()} onInstall={vi.fn()} onStart={vi.fn()} />,
			)
			const found = !!container.querySelector("[data-testid='gateway-ladder']")
			const line = container.querySelector("[data-testid='ladder-board']")?.textContent ?? ""
			unmount()
			return { found, line }
		}

		// What the probes actually report on a bench with this gateway attached.
		const both = render1(["nRF54LM20B", "nRF9151", "nRF5340"])
		expect(both.found, "both chips present is the board").toBe(true)
		expect(both.line).toContain("nRF54LM20B")
		expect(both.line).toContain("nRF9151")

		// One alone is a different kit, and must not summon this card.
		expect(render1(["nRF54LM20B", "nRF5340"]).found, "the BLE half alone is not the board").toBe(false)
		expect(render1(["nRF9151"]).found, "the cellular half alone is not the board").toBe(false)
		expect(render1(["nRF5340", "nRF52840"]).found, "neither is certainly not the board").toBe(false)
		expect(render1([]).found).toBe(false)

		// And the helper says the same thing on its own.
		expect(ladderChipPair(["nRF54LM20B", "nRF9151"])).toEqual(["nRF54LM20B", "nRF9151"])
		expect(ladderChipPair(["nRF54LM20B"])).toBeUndefined()
		expect(ladderChipPair(["nRF9151"])).toBeUndefined()

		// A printed board name still wins, and reads as a board rather than as evidence.
		const named = render([
			<GatewayLadder
				boards={["Fanstel BLG20XE02C"]}
				chips={["nRF54LM20B", "nRF9151"]}
				key="named"
				onAsk={vi.fn()}
				onInstall={vi.fn()}
				onStart={vi.fn()}
			/>,
		])
		expect(screen.getByTestId("ladder-board").textContent).toBe("Fanstel BLG20XE02C")
		named.unmount()
	})

	it("F12 the demo card says a licence notice travels with the images, in one line", () => {
		state.current = account(["blg20-demo-hex"])
		render(<DemoHexCard onFlash={vi.fn()} />)
		const line = screen.getByTestId("demo-licence").textContent ?? ""
		expect(line).toBe("A licence notice is written next to the images.")
		// One line at the narrow width, and no legal text or dead link on a card.
		expect(line.length).toBeLessThanOrEqual(60)
		expect(line).not.toMatch(/http|www\.|licen[cs]e agreement|terms and conditions|warrant|liab/i)
	})
})

function assert_length(key: string, line: string, budget: number) {
	expect(line.length, `LADDER_COPY.${key} is ${line.length} characters: "${line}"`).toBeLessThanOrEqual(budget)
}
