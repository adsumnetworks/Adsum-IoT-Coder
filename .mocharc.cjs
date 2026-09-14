// Mocha runs mocha tests only. Files written for node's own runner are ignored here and run by
// `npm run test:node` (scripts/run-node-tests.mjs), which fails on any red file — inside mocha their
// failures printed ✖ and never failed the run. One shared definition decides which files those are.
const { findNodeRunnerTests } = require("./scripts/node-runner-tests.cjs")

module.exports = {
	extension: ["ts"],
	spec: ["src/**/__tests__/*.ts"],
	ignore: findNodeRunnerTests(),
	require: ["ts-node/register", "source-map-support/register", "./src/test/requires.ts"],
	recursive: true,
	exit: true,
}
