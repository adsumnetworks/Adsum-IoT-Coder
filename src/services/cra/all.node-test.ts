// Aggregate runner — imports every CVE-substrate node:test so `npm run test:cve` runs them in one process.
// (Each module file registers its tests at import; node:test runs them all.)
import "./sbomNormalize.node-test"
import "./osvMatch.node-test"
import "./applicability.node-test"
import "./evidenceReport.node-test"
import "./vexEmit.node-test"
