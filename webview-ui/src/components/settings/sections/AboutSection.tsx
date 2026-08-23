import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

/**
 * What this extension is, in the words a developer would use for it.
 *
 * The previous copy described a Nordic-only log assistant, which stopped being true two platforms and a
 * compliance workflow ago, and its links pointed at a repository that has since been renamed and at
 * Nordic's own site. An About page is where someone checks what they installed; it should describe the
 * product as it is and point at the project's own resources.
 *
 * The words are the site's own (docs.adsumnetworks.com), deliberately: the page someone reads before
 * installing and the page they read after should not describe two different products.
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
						An open-source AI coding agent for embedded IoT work. It automates the routine IoT firmware work you would
						rather not do, and cracks the runtime bugs general agents cannot — because it reads your board, not just
						your code. The whole firmware loop: scaffold, build, flash, test, observe, fix, and one-click CRA
						readiness.
					</p>
					<p>
						What makes it different is real human expertise, not just the model. It is augmented with curated firmware
						knowledge written by engineers who have shipped — <b>Knowledge bits</b> and <b>Tool bits</b>, loaded on
						demand, credited to their author, and updatable without waiting for a release. Human-curated, not
						AI-generated.
					</p>
					<p>
						Shipping today: Nordic nRF52 / nRF53 / nRF54L on the nRF Connect SDK (Zephyr) and Espressif ESP32,
						ESP32-S3 and ESP32-C6 on ESP-IDF, over BLE and Wi-Fi.
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
