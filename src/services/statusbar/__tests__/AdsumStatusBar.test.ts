import { describe, it } from "mocha"
import "should"
import { formatStatusText } from "../AdsumStatusBar"

const ICON = "$(adsum-iot-coder-icon)"

describe("formatStatusText", () => {
	it("returns bare label when tokens are undefined (BYOK / not on free tier)", () => {
		formatStatusText(undefined).should.equal(`${ICON} Adsum Coder`)
	})

	it("returns bare label when called with no args", () => {
		formatStatusText().should.equal(`${ICON} Adsum Coder`)
	})

	it("shows raw count for sub-1k values", () => {
		formatStatusText(0).should.equal(`${ICON} Adsum Coder · $(zap) 0`)
		formatStatusText(1).should.equal(`${ICON} Adsum Coder · $(zap) 1`)
		formatStatusText(999).should.equal(`${ICON} Adsum Coder · $(zap) 999`)
	})

	it("formats exactly 1000 as 1K", () => {
		formatStatusText(1000).should.equal(`${ICON} Adsum Coder · $(zap) 1K`)
	})

	it("rounds to nearest K (matching FreeTierStrip rule: Math.round(n/1000))", () => {
		formatStatusText(487000).should.equal(`${ICON} Adsum Coder · $(zap) 487K`)
		formatStatusText(500000).should.equal(`${ICON} Adsum Coder · $(zap) 500K`)
		formatStatusText(486500).should.equal(`${ICON} Adsum Coder · $(zap) 487K`) // rounds up
		formatStatusText(486499).should.equal(`${ICON} Adsum Coder · $(zap) 486K`) // rounds down
	})

	it("formats values at or above 1M with one decimal", () => {
		formatStatusText(1_000_000).should.equal(`${ICON} Adsum Coder · $(zap) 1M`)
		formatStatusText(1_300_000).should.equal(`${ICON} Adsum Coder · $(zap) 1.3M`)
		formatStatusText(1_250_000).should.equal(`${ICON} Adsum Coder · $(zap) 1.3M`) // rounds up
		formatStatusText(2_500_000).should.equal(`${ICON} Adsum Coder · $(zap) 2.5M`)
	})
})

describe("formatStatusText — BYOK regression (no credit shown off free tier)", () => {
	it("undefined tokens → no zap suffix (BYOK user sees clean label only)", () => {
		const text = formatStatusText(undefined)
		text.should.not.containEql("$(zap)")
		text.should.not.containEql("K")
	})

	it("label is present regardless of provider (button always reveals sidebar)", () => {
		formatStatusText(undefined).should.containEql("Adsum Coder")
		formatStatusText(100000).should.containEql("Adsum Coder")
	})
})

describe("formatStatusText — consistency with FreeTierStrip", () => {
	// FreeTierStrip formatTokens rule: ≥1M → one decimal M, ≥1K → rounded K, else raw.
	// Both must use identical rounding. This test acts as a regression guard.
	function freeTierStripRule(n: number): string {
		if (n >= 1_000_000) {
			return `${Math.round(n / 100_000) / 10}M`
		}
		return n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`
	}

	const samples = [0, 1, 999, 1000, 1499, 1500, 10000, 100000, 487000, 500000, 999999, 1_000_000, 1_300_000, 2_500_000]
	for (const n of samples) {
		it(`token count ${n}: status bar and strip use identical label`, () => {
			const stripLabel = freeTierStripRule(n)
			const barText = formatStatusText(n)
			barText.should.equal(`${ICON} Adsum Coder · $(zap) ${stripLabel}`)
		})
	}
})
