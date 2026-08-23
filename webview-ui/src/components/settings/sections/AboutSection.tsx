import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

/**
 * What this extension is, in the words a developer would use for it.
 *
 * The previous copy described a Nordic-only log assistant, which stopped being true two platforms and a
 * compliance workflow ago, and its links pointed at a repository that has since been renamed and at
 * Nordic's own site. An About page is where someone checks what they installed; it should describe the
 * product as it is and point at the project's own resources.
 */

const REPO = "https://github.com/adsumnetworks/Adsum-IoT-Coder"
const DOCS = "https://docs.adsumnetworks.com"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">Adsum IoT Coder v{version}</h2>
					<p>
						An open-source coding agent for embedded work. It builds, flashes and debugs firmware on real hardware,
						reads the logs the board actually produced, and runs a Cyber Resilience Act readiness check over a project
						— an SBOM, a secure-by-design review, and the CVEs that apply to what you are shipping.
					</p>
					<p>
						It works on Espressif ESP32 with ESP-IDF, and on Nordic nRF with the nRF Connect SDK and Zephyr. What it
						knows about a board, a protocol or a tool comes from <b>Knowledge bits</b> and <b>Tool bits</b> —
						versioned, credited to the engineer who wrote them, and updatable without waiting for a release.
					</p>

					<h3 className="text-md font-semibold">Documentation</h3>
					<p>
						<VSCodeLink href={`${DOCS}/getting-started`}>Getting started</VSCodeLink>
						{" • "}
						<VSCodeLink href={`${DOCS}/knowledge-bits`}>Knowledge bits</VSCodeLink>
						{" • "}
						<VSCodeLink href={`${DOCS}/cra-readiness`}>CRA readiness</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Community &amp; Support</h3>
					<p>
						<VSCodeLink href={REPO}>GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href={`${REPO}/issues`}>Report an issue</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
