#!/usr/bin/env node
/**
 * Proto Linting Script (Cross-platform)
 * Replaces bash script for Windows compatibility
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const { globSync } = require("glob")

const isWindows = process.platform === "win32"

function runCommand(command, description) {
	console.log(`\n📋 ${description}`)
	try {
		const result = execSync(command, {
			stdio: "inherit",
			shell: isWindows ? "cmd.exe" : "/bin/bash",
		})
		return true
	} catch (error) {
		console.error(`❌ ${description} failed`)
		return false
	}
}

function lintProtos() {
	console.log("🚀 Starting proto linting...\n")

	// Step 1: Run buf lint
	if (!runCommand("buf lint", "buf lint")) {
		process.exit(1)
	}

	// Step 2: Run buf format with check
	console.log("\n📋 buf format --exit-code")
	try {
		execSync("buf format -w --exit-code", {
			stdio: "inherit",
		})
	} catch (error) {
		console.log("⚠️  Proto files were formatted")
	}

	// Step 3: Check for repeated capital letters in RPC names (Windows-compatible grep)
	console.log("\n📋 Checking RPC naming conventions...")
	const protoFiles = globSync("proto/**/*.proto")
	let hasRpcError = false

	for (const file of protoFiles) {
		const content = fs.readFileSync(file, "utf-8")
		const lines = content.split("\n")

		lines.forEach((line, index) => {
			// Look for rpc lines with repeated capitals
			if (line.includes("rpc ") && /rpc\s+[A-Z][A-Z]/.test(line)) {
				console.error(`${file}:${index + 1}: Error: rpc name has repeated capital letters`)
				console.error(`  ${line.trim()}`)
				hasRpcError = true
			}
		})
	}

	if (hasRpcError) {
		console.error("\n❌ See https://github.com/cline/cline/pull/7054")
		process.exit(1)
	}

	console.log("✅ Proto linting complete!")
	process.exit(0)
}

lintProtos()
