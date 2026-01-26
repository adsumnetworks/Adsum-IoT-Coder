const path = require("path")
const assert = require("assert")

// Mock vscode before requiring the handler
const Module = require("module")
const originalRequire = Module.prototype.require

const vscodeMock = {
	commands: {
		executeCommand: async (cmd) => {
			console.log(`[Mock VSCode] Executing command: ${cmd}`)
			return undefined
		},
	},
	extensions: {
		getExtension: (id) => {
			console.log(`[Mock VSCode] Checking extension: ${id}`)
			return { id }
		},
	},
}

Module.prototype.require = function (request) {
	if (request === "vscode") {
		return vscodeMock
	}
	return originalRequire.apply(this, arguments)
}

// Register ts-node
require("ts-node").register({
	project: "./tsconfig.unit-test.json",
	transpileOnly: true,
})

// Import the handler
const { TriggerNordicActionHandler } = require("../src/core/task/tools/handlers/TriggerNordicActionHandler.ts")

async function runTest() {
	console.log("Starting verification...")
	const handler = new TriggerNordicActionHandler()

	const config = {
		taskState: { consecutiveMistakeCount: 0 },
		callbacks: {
			say: async (type, msg) => console.log(`[Agent Say] ${type}: ${msg}`),
			sayAndCreateMissingParamError: async () => console.log("[Agent Error] Missing Param"),
		},
	}

	// Test 1: Build
	console.log("\nTesting 'build' action...")
	await handler.execute(config, { params: { action: "build" }, name: "trigger_nordic_action" })

	// Test 2: Terminal
	console.log("\nTesting 'terminal' action...")
	await handler.execute(config, { params: { action: "terminal" }, name: "trigger_nordic_action" })

	console.log("\nVerification Complete!")
}

runTest().catch(console.error)
