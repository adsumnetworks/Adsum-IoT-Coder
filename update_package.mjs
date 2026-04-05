import fs from "fs"

const packagePath = "package.json"
let content = fs.readFileSync(packagePath, "utf8")

// Replace "cline." with "iot-ai-debugger."
content = content.replace(/"cline\./g, '"iot-ai-debugger.')
content = content.replace(/!cline\./g, "!iot-ai-debugger.")
content = content.replace(/ cline\./g, " iot-ai-debugger.")

// Replace claude-dev
content = content.replace(/claude-dev/g, "iot-ai-debugger")
content = content.replace(/cline-ai-review/g, "iot-ai-debugger-review")

fs.writeFileSync(packagePath, content)
console.log("package.json updated!")
