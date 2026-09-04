import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import { BRAND_CORAL, BRAND_CYAN_600 } from "../../chat/brandColors"
import { TYPE } from "../../chat/welcome/typography"
import Section from "../Section"

/**
 * What this extension is, in the words a developer would use for it.
 *
 * An About page is where someone checks what they installed, so it leads with the mark and the
 * version, says in one line what the product is, and then states the two things that make it
 * different as facts rather than as paragraphs — the page someone reads before installing
 * (docs.adsumnetworks.com) and the page they read after should describe one product, and neither
 * should make them read marketing to find the version number.
 *
 * [OPERATOR 2026-09-04] "enhance our about screen and add our logo". The previous page was a
 * heading and three paragraphs of body text: correct, and indistinguishable from any other
 * extension's About. The wordmark is the same asset and the same theme rule as the entry surface
 * (`.adsum-wordmark-*` in index.css), so it can never be white-on-white here either.
 */

const REPO = "https://github.com/adsumnetworks/Adsum-IoT-Coder"
const DOCS = "https://docs.adsumnetworks.com"
const SITE = "https://www.adsumnetworks.com"

const PLATFORMS: { family: string; sdk: string; chips: string[] }[] = [
	{ family: "Nordic", sdk: "nRF Connect SDK · Zephyr", chips: ["nRF52", "nRF53", "nRF54L"] },
	{ family: "Espressif", sdk: "ESP-IDF", chips: ["ESP32", "ESP32-S3", "ESP32-C6"] },
]

const Chip = ({ text }: { text: string }) => (
	<span
		className="rounded px-1.5 py-0.5"
		style={{
			...TYPE.meta,
			fontFamily: "var(--vscode-editor-font-family)",
			background: "var(--vscode-badge-background)",
			color: "var(--vscode-badge-foreground)",
		}}>
		{text}
	</span>
)

const Label = ({ children }: { children: React.ReactNode }) => (
	<div style={{ ...TYPE.label, color: "var(--vscode-descriptionForeground)" }}>{children}</div>
)

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex flex-col gap-5 px-4" style={{ maxWidth: "560px" }}>
					{/* The mark, then the one fact everyone comes here for. */}
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-3">
							<img
								alt="Adsum IoT Coder"
								className="adsum-wordmark-dark"
								src={adsumLogoDark}
								style={{ height: "26px" }}
							/>
							<img
								alt=""
								aria-hidden="true"
								className="adsum-wordmark-light"
								src={adsumLogoLight}
								style={{ height: "26px" }}
							/>
							<span
								className="rounded px-1.5 py-0.5"
								data-testid="about-version"
								style={{
									...TYPE.meta,
									fontFamily: "var(--vscode-editor-font-family)",
									border: "1px solid var(--vscode-panel-border)",
									color: "var(--vscode-descriptionForeground)",
								}}
								title="Extension version">
								v{version}
							</span>
						</div>
						<p style={{ ...TYPE.title, margin: 0, color: "var(--vscode-foreground)" }}>
							An open-source AI coding agent for embedded IoT firmware.
						</p>
						<p style={{ ...TYPE.body, margin: 0, color: "var(--vscode-descriptionForeground)" }}>
							The whole loop on your real board — scaffold, build, flash, test, observe, fix — and one-click CRA
							readiness.
						</p>
					</div>

					{/* The two differentiators, as facts with a coral tick: the accent is identity, so it marks
					    what is ours and nothing else on the page. */}
					<div className="flex flex-col gap-2">
						<Label>What makes it different</Label>
						{[
							{
								head: "It reads your board, not just your code.",
								body: "Serial, RTT, HCI and the radio itself are evidence, so the runtime bugs general agents guess at get diagnosed from what the hardware actually did.",
							},
							{
								head: "Human-curated knowledge, not AI-generated.",
								body: "Knowledge bits and Tool bits written by engineers who have shipped — loaded on demand, credited to their author, updated without waiting for a release.",
							},
						].map((f) => (
							<div className="flex gap-2.5" key={f.head}>
								<span
									aria-hidden="true"
									className="codicon codicon-check shrink-0"
									style={{ fontSize: "14px", marginTop: "1px", color: BRAND_CORAL }}
								/>
								<div className="flex flex-col gap-0.5">
									<span style={{ ...TYPE.body, fontWeight: 600, color: "var(--vscode-foreground)" }}>
										{f.head}
									</span>
									<span style={{ ...TYPE.meta, color: "var(--vscode-descriptionForeground)" }}>{f.body}</span>
								</div>
							</div>
						))}
					</div>

					{/* Platforms as chips, grouped by SDK — the shape of the question ("does it do my chip?"). */}
					<div className="flex flex-col gap-2">
						<Label>Runs on</Label>
						{PLATFORMS.map((p) => (
							<div className="flex flex-wrap items-center gap-1.5" key={p.family}>
								<span
									style={{
										...TYPE.body,
										fontWeight: 600,
										minWidth: "72px",
										color: "var(--vscode-foreground)",
									}}>
									{p.family}
								</span>
								{p.chips.map((c) => (
									<Chip key={c} text={c} />
								))}
								<span style={{ ...TYPE.meta, color: "var(--vscode-descriptionForeground)" }}>{p.sdk}</span>
							</div>
						))}
						<div className="flex flex-wrap items-center gap-1.5">
							<span style={{ ...TYPE.body, fontWeight: 600, minWidth: "72px", color: "var(--vscode-foreground)" }}>
								Radios
							</span>
							<Chip text="BLE" />
							<Chip text="Wi-Fi" />
							<Chip text="LTE" />
							<span style={{ ...TYPE.meta, color: "var(--vscode-descriptionForeground)" }}>
								LTE on the LEW840x gateway
							</span>
						</div>
					</div>

					{/* Links: cyan is action, and these are the only actions on the page. */}
					<div className="flex flex-col gap-2">
						<Label>Documentation</Label>
						<div className="flex flex-wrap gap-x-4 gap-y-1" style={TYPE.body}>
							<VSCodeLink href={`${DOCS}/getting-started`}>Getting started</VSCodeLink>
							<VSCodeLink href={`${DOCS}/knowledge-bits`}>Knowledge bits</VSCodeLink>
							<VSCodeLink href={`${DOCS}/cra-readiness`}>CRA readiness</VSCodeLink>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Label>Community &amp; support</Label>
						<div className="flex flex-wrap gap-x-4 gap-y-1" style={TYPE.body}>
							<VSCodeLink href={REPO}>GitHub</VSCodeLink>
							<VSCodeLink href={`${REPO}/issues`}>Report an issue</VSCodeLink>
							<VSCodeLink href={SITE}>adsumnetworks.com</VSCodeLink>
						</div>
					</div>

					<div
						className="pt-3"
						style={{
							...TYPE.meta,
							color: "var(--vscode-descriptionForeground)",
							borderTop: "1px solid var(--vscode-panel-border)",
						}}>
						© Adsum Networks · open source ·{" "}
						<VSCodeLink href={`${REPO}/blob/main/LICENSE`} style={{ color: BRAND_CYAN_600, fontSize: "inherit" }}>
							licence
						</VSCodeLink>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
