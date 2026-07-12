import { defineConfig } from "@vscode/test-cli"
import os from "os"
import path from "path"

// VS Code's IPC socket lives under `<user-data-dir>/<version>-main.sock`; a long checkout path (e.g. a deeply
// nested project folder) can push that past the ~103-char Unix socket path limit, failing with `listen EINVAL`
// before any test runs. Pin both dirs under the OS temp dir so the socket path stays short regardless of
// where this repo is checked out.
const shortUserDataDir = path.join(os.tmpdir(), "adsum-vscode-test-user-data")
const shortExtensionsDir = path.join(os.tmpdir(), "adsum-vscode-test-extensions")

export default defineConfig({
	files: "{out/**/*.test.js,src/**/*.test.js,!src/test/e2e/**/*.test.js,!out/src/test/e2e/**/*.test.js}",
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up alias path resolution during tests
		 * @See {@link file://./test-setup.js}
		 */
		require: ["./test-setup.js"],
	},
	workspaceFolder: "test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions", "--user-data-dir", shortUserDataDir, "--extensions-dir", shortExtensionsDir],
})
