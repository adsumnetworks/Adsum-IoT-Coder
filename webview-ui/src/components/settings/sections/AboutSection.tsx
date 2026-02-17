import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

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
					<h2 className="text-lg font-semibold">nRF AI Debugger v{version}</h2>
					<p>
						An AI-powered debugging assistant for Nordic nRF Connect SDK. It helps you analyze logs, generate debugging code, 
						and troubleshoot RTT/UART output using advanced reasoning capabilities.
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://github.com/adsumnetworks/AIDebug-Agent">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/adsumnetworks/AIDebug-Agent/issues">Issues</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://www.nordicsemi.com">Nordic Semiconductor</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/index.html">nRF Connect SDK Docs</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
