import * as crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { fileExistsAtPath } from "@/utils/fs"

export class IotProjectMemoryManager {
	private cwd: string
	private memoryDir: string

	constructor(cwd: string) {
		this.cwd = cwd
		// Use a hash of the workspace path to create an isolated directory in globalStorage
		const hash = crypto.createHash("md5").update(cwd).digest("hex")
		const globalStorage = HostProvider.get().globalStorageFsPath
		this.memoryDir = path.join(globalStorage, "iot-memory", hash)
	}

	async initialize(): Promise<void> {
		try {
			await fs.mkdir(this.memoryDir, { recursive: true })

			const filesToInitialize = [
				{
					name: "project.md",
					content: `# Workspace: ${path.basename(this.cwd)}\n\n## Project Context\n\nAdd details about the application logic, dependencies, and overall architecture here.\n`,
				},
				{
					name: "devices.md",
					content: `# Device & Hardware Profiles\n\n## Target Hardware\n\nDocument the board target (e.g., nrf52840dk), pin configurations, and external sensors here.\n`,
				},
				{
					name: "session.md",
					content: `# Session Memory\n\n## Current Debugging State\n\nKeep track of the current problem, open issues, and findings from the latest debug loop.\n`,
				},
			]

			for (const file of filesToInitialize) {
				const fullPath = path.join(this.memoryDir, file.name)
				if (!(await fileExistsAtPath(fullPath))) {
					await fs.writeFile(fullPath, file.content, "utf-8")
				}
			}
		} catch (error) {
			console.error(`Failed to initialize IoT memory for workspace ${this.cwd}:`, error)
		}
	}

	async getMemoryContext(): Promise<string> {
		let contextStr = `\n### 🧠 IoT PROJECT MEMORY (Long-Term Context)\n\n`
		contextStr += `**CRITICAL:** These files are your official Long-Term Memory for this workspace. They are stored outside the repository at the absolute paths listed below. You MUST read these files at the start of a session to understand the project state, and you MUST update them when significant progress or discoveries are made.\n\n`
		contextStr += `**You have full, explicit permission to read and write to these specific absolute paths using your standard tools.**\n\n`

		const filesToRead = ["project.md", "devices.md", "session.md"]

		for (const filename of filesToRead) {
			const fullPath = path.join(this.memoryDir, filename)
			contextStr += `#### 📁 ${filename}\n`
			contextStr += `**Path:** \`${fullPath}\`\n\n`
			try {
				if (await fileExistsAtPath(fullPath)) {
					const content = await fs.readFile(fullPath, "utf-8")
					contextStr += `\`\`\`markdown\n${content.trim()}\n\`\`\`\n\n`
				} else {
					contextStr += `*File missing. Please recreate it.*\n\n`
				}
			} catch (err) {
				contextStr += `*(Error reading ${filename})*\n\n`
			}
		}

		return contextStr
	}
}
