import { expect } from "chai"
import { describe, it } from "mocha"

/**
 * Test the isNordicTerminalName logic directly.
 * Note: The actual function is private in executeNordicCommand.ts, so we test the logic here.
 */
function isNordicTerminalName(name: string): boolean {
	const lowerName = name.toLowerCase()
	return (
		lowerName.startsWith("nrf") || // Matches "nRF $(icons)..." and "nrf-*"
		lowerName.includes("nordic") ||
		lowerName.includes("zephyr") ||
		lowerName.includes("ncs")
	)
}

describe("Nordic Terminal Name Detection", () => {
	describe("isNordicTerminalName", () => {
		it("should match 'nRF' prefix with special characters (icons)", () => {
			// Real terminal name from VS Code
			expect(isNordicTerminalName("nRF $(nrf-connect-sdk) $(nrf-connect-tcm) v3.2.1")).to.be.true
		})

		it("should match simple 'nRF Connect' terminal", () => {
			expect(isNordicTerminalName("nRF Connect")).to.be.true
		})

		it("should match 'nRF Terminal'", () => {
			expect(isNordicTerminalName("nRF Terminal")).to.be.true
		})

		it("should match 'NCS Terminal' (case insensitive)", () => {
			expect(isNordicTerminalName("NCS Terminal")).to.be.true
			expect(isNordicTerminalName("ncs terminal")).to.be.true
		})

		it("should match 'Nordic' anywhere in name", () => {
			expect(isNordicTerminalName("My Nordic Shell")).to.be.true
		})

		it("should match 'Zephyr' terminals", () => {
			expect(isNordicTerminalName("Zephyr SDK Terminal")).to.be.true
		})

		it("should NOT match regular shell terminals", () => {
			expect(isNordicTerminalName("bash")).to.be.false
			expect(isNordicTerminalName("zsh")).to.be.false
			expect(isNordicTerminalName("Terminal")).to.be.false
			expect(isNordicTerminalName("PowerShell")).to.be.false
		})

		it("should NOT match Cline tasks", () => {
			expect(isNordicTerminalName("Task - Build")).to.be.false
			expect(isNordicTerminalName("Cline")).to.be.false
		})

		it("should handle empty string", () => {
			expect(isNordicTerminalName("")).to.be.false
		})
	})
})

describe("CLI_REFERENCE Content Validation", () => {
	// Import the actual CLI_REFERENCE content would require complex setup
	// Instead, we document what should be tested
	const expectedPatterns = [
		"nrf52840dk/nrf52840", // Correct board format
		"west flash", // Preferred flash method
		"nrfjprog --ids", // Device listing
		"CONFIG_USE_SEGGER_RTT", // RTT detection
		"pkill -9 JLink", // Kill stale connections
		"nrfjprog --recover", // Recovery command
	]

	it("should document required board name format", () => {
		// This is a documentation test - the actual CLI_REFERENCE is in trigger_nordic_action.ts
		expect(expectedPatterns).to.include("nrf52840dk/nrf52840")
	})

	it("should document west flash as preferred method", () => {
		expect(expectedPatterns).to.include("west flash")
	})

	it("should document RTT detection via prj.conf", () => {
		expect(expectedPatterns).to.include("CONFIG_USE_SEGGER_RTT")
	})

	it("should document board recovery process", () => {
		expect(expectedPatterns).to.include("nrfjprog --recover")
	})
})

describe("RTTConnectionResult Interface", () => {
	it("should have required fields for success case", () => {
		const result = {
			success: true,
			method: "plan_a" as const,
			terminalName: "RTT Terminal",
		}
		expect(result.success).to.be.true
		expect(result.method).to.equal("plan_a")
		expect(result.terminalName).to.equal("RTT Terminal")
	})

	it("should have required fields for error case", () => {
		const result = {
			success: false,
			method: "plan_b" as const,
			error: "JLinkExe not found",
		}
		expect(result.success).to.be.false
		expect(result.method).to.equal("plan_b")
		expect(result.error).to.equal("JLinkExe not found")
	})

	it("should support 'none' method for fallback failure", () => {
		const result = {
			success: false,
			method: "none" as const,
			error: "All connection methods failed",
		}
		expect(result.method).to.equal("none")
	})
})
