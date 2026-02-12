const { spawnSync } = require("child_process")

console.log("Testing Python detection...\n")

const candidates = ["python3", "python", "py"]

for (const cmd of candidates) {
	try {
		const args = cmd === "py" ? ["-3", "--version"] : ["--version"]
		const res = spawnSync(cmd, args, { encoding: "utf8" })
		if (res.status === 0) {
			const output = res.stdout + res.stderr
			if (/Python 3/.test(output)) {
				console.log(`✓ FOUND: ${cmd === "py" ? "py -3" : cmd}`)
				console.log(output)
				process.exit(0)
			}
		}
	} catch (e) {
		console.log(`✗ ${cmd} not available`)
	}
}

console.log("\n✗ No Python 3 detected!")
process.exit(1)
