import { describe, expect, it } from "vitest"
import { enforceScope } from "../nordicScopeEnforcer"

describe("enforceScope", () => {
	describe("log_generator mode", () => {
		it("rejects build-related messages", () => {
			expect(enforceScope("log_generator", "How do I build this?")).not.toBeNull()
		})

		it("rejects flash-related messages", () => {
			expect(enforceScope("log_generator", "Can you flash the firmware?")).not.toBeNull()
		})

		it("rejects compile-related messages", () => {
			expect(enforceScope("log_generator", "compile my code please")).not.toBeNull()
		})

		it("rejects debug-related messages", () => {
			expect(enforceScope("log_generator", "I need to debug this issue")).not.toBeNull()
		})

		it("allows logging-related messages", () => {
			expect(enforceScope("log_generator", "Add LOG_INF to my main.c")).toBeNull()
		})

		it("allows file path messages", () => {
			expect(enforceScope("log_generator", "src/main.c")).toBeNull()
		})

		it("allows prj.conf questions", () => {
			expect(enforceScope("log_generator", "Configure prj.conf for RTT")).toBeNull()
		})
	})

	describe("log_analyzer mode", () => {
		it("rejects generate+log messages", () => {
			expect(enforceScope("log_analyzer", "Can you generate log macros?")).not.toBeNull()
		})

		it("rejects create+log messages", () => {
			expect(enforceScope("log_analyzer", "Create a log module in my file")).not.toBeNull()
		})

		it("rejects add+log messages", () => {
			expect(enforceScope("log_analyzer", "Add some log statements")).not.toBeNull()
		})

		it("allows analysis questions", () => {
			expect(enforceScope("log_analyzer", "What errors did you find?")).toBeNull()
		})

		it("allows device questions", () => {
			expect(enforceScope("log_analyzer", "Record from device 682635789")).toBeNull()
		})

		it("allows duration questions", () => {
			expect(enforceScope("log_analyzer", "Record for 5 minutes")).toBeNull()
		})
	})

	describe("null mode", () => {
		it("returns null when mode is null", () => {
			expect(enforceScope(null, "anything")).toBeNull()
		})
	})
})
