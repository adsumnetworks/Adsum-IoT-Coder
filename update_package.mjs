import fs from "fs"

const packagePath = "package.json"
let content = fs.readFileSync(packagePath, "utf8")

// Replace "cline." with "adsum-iot-coder."
content = content.replace(/"cline\./g, '"adsum-iot-coder.')
content = content.replace(/!cline\./g, "!adsum-iot-coder.")
content = content.replace(/ cline\./g, " adsum-iot-coder.")

// Replace claude-dev
content = content.replace(/claude-dev/g, "adsum-iot-coder")
content = content.replace(/cline-ai-review/g, "adsum-iot-coder-review")

fs.writeFileSync(packagePath, content)
console.log("package.json updated!")
