import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import mermaid from "mermaid"
import { useEffect, useRef, useState } from "react"
import styled from "styled-components"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { FileServiceClient } from "@/services/grpc-client"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

// Two complete theme-variable sets so diagrams are legible AND on-brand in BOTH VS Code light and dark themes.
// (Previously hardcoded to dark → black boxes on white, near-invisible in light mode.) Brand palette:
// cyan #1FA7B3 (action), coral #E07D5F (the bug / problem), grey #8a8a8a (neutral lines).
const MERMAID_THEME_DARK = {
	background: "#1e1e1e",
	textColor: "#ffffff",
	mainBkg: "#2d2d2d",
	nodeBorder: "#888888",
	lineColor: "#cccccc",
	primaryColor: "#3c3c3c",
	primaryTextColor: "#ffffff",
	primaryBorderColor: "#888888",
	secondaryColor: "#2d2d2d",
	tertiaryColor: "#454545",
	classText: "#ffffff",
	labelColor: "#ffffff",
	actorLineColor: "#cccccc",
	actorBkg: "#2d2d2d",
	actorBorder: "#888888",
	actorTextColor: "#ffffff",
	fillType0: "#2d2d2d",
	fillType1: "#3c3c3c",
	fillType2: "#454545",
	noteTextColor: "#ffffff",
	noteBkgColor: "#454545",
	noteBorderColor: "#888888",
	critBorderColor: "#ff9580",
	critBkgColor: "#803d36",
	taskTextColor: "#ffffff",
	taskTextOutsideColor: "#ffffff",
	taskTextLightColor: "#ffffff",
	sectionBkgColor: "#2d2d2d",
	sectionBkgColor2: "#3c3c3c",
	altBackground: "#2d2d2d",
	linkColor: "#6cb6ff",
	compositeBackground: "#2d2d2d",
	compositeBorder: "#888888",
	titleColor: "#ffffff",
}

const MERMAID_THEME_LIGHT = {
	background: "#ffffff",
	textColor: "#1f2328",
	mainBkg: "#e8f7f9",
	nodeBorder: "#1FA7B3",
	lineColor: "#8a8a8a",
	primaryColor: "#e8f7f9",
	primaryTextColor: "#0f3f45",
	primaryBorderColor: "#1FA7B3",
	secondaryColor: "#fdeee8",
	tertiaryColor: "#f4f4f5",
	classText: "#1f2328",
	labelColor: "#1f2328",
	actorLineColor: "#8a8a8a",
	actorBkg: "#e8f7f9",
	actorBorder: "#1FA7B3",
	actorTextColor: "#0f3f45",
	fillType0: "#e8f7f9",
	fillType1: "#fdeee8",
	fillType2: "#f4f4f5",
	noteTextColor: "#7a2e15",
	noteBkgColor: "#fdeee8",
	noteBorderColor: "#E07D5F",
	critBorderColor: "#E07D5F",
	critBkgColor: "#fdeee8",
	taskTextColor: "#1f2328",
	taskTextOutsideColor: "#1f2328",
	taskTextLightColor: "#1f2328",
	sectionBkgColor: "#e8f7f9",
	sectionBkgColor2: "#f4f4f5",
	altBackground: "#f4f4f5",
	linkColor: "#1FA7B3",
	compositeBackground: "#ffffff",
	compositeBorder: "#8a8a8a",
	titleColor: "#1f2328",
}

/** Full mermaid.initialize config for the active VS Code theme (re-applied before each render). */
function mermaidThemeFor(isDark: boolean) {
	return {
		startOnLoad: false,
		securityLevel: "loose" as const,
		theme: (isDark ? "dark" : "base") as "dark" | "base",
		themeVariables: {
			...(isDark ? MERMAID_THEME_DARK : MERMAID_THEME_LIGHT),
			fontSize: "16px",
			fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",
		},
	}
}

interface MermaidBlockProps {
	code: string
}

/**
 * Some models emit the whole diagram on a single line — mermaid needs statement breaks, so it fails to parse and
 * we fall back to showing the raw text. Two single-line shapes are recovered (multi-line sources are left
 * untouched — a real "\n" inside a node label stays intact):
 *  (a) literal "\n"/"\t" escapes instead of real newlines → treat them as the intended line breaks;
 *  (b) a flat real-space line like `flowchart LR a-->b classDef done ...; classDef active ...` → re-introduce
 *      the breaks mermaid needs: a newline after the graph direction, and each classDef/class/subgraph/style/
 *      linkStyle/`;`-separated statement on its own line (the node chain `a-->b-->c` legitimately stays one line).
 */
export function normalizeMermaidSource(src: string): string {
	if (src.includes("\n")) {
		return src
	}
	if (/\\n/.test(src)) {
		return src.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
	}
	const m = /^\s*(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b\s*(.*)$/is.exec(src)
	if (m) {
		const body = m[3]
			.replace(/\s+(classDef|class|subgraph|linkStyle|style|end)\b/g, "\n$1")
			.replace(/;\s*/g, "\n")
			.trim()
		return `${m[1]} ${m[2]}\n${body}`
	}
	return src
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [isLoading, setIsLoading] = useState(false)
	const { isDark } = useVSCodeTheme()

	// 1) Whenever `code` or the VS Code theme changes, mark that we need to re-render
	useEffect(() => {
		setIsLoading(true)
	}, [code, isDark])

	// 2) Debounce the actual parse/render — re-initialize mermaid for the active theme each render so diagrams
	//    track VS Code light/dark (and our brand palette) instead of a fixed dark theme.
	useDebounceEffect(
		() => {
			if (containerRef.current) {
				containerRef.current.innerHTML = ""
			}
			mermaid.initialize(mermaidThemeFor(isDark))
			// Normalize literal "\n" escapes some models emit instead of real newlines.
			const source = normalizeMermaidSource(code)
			mermaid
				.parse(source, { suppressErrors: true })
				.then((isValid) => {
					if (!isValid) {
						throw new Error("Invalid or incomplete Mermaid code")
					}
					const id = `mermaid-${Math.random().toString(36).substring(2)}`
					return mermaid.render(id, source)
				})
				.then(({ svg }) => {
					if (containerRef.current) {
						containerRef.current.innerHTML = svg
					}
				})
				.catch((err) => {
					console.warn("Mermaid parse/render failed:", err)
					containerRef.current!.innerHTML = source.replace(/</g, "&lt;").replace(/>/g, "&gt;")
				})
				.finally(() => {
					setIsLoading(false)
				})
		},
		500, // Delay 500ms
		[code, isDark], // Dependencies for scheduling
	)

	/**
	 * Called when user clicks the rendered diagram.
	 * Converts the <svg> to a PNG and sends it to the extension.
	 */
	const handleClick = async () => {
		if (!containerRef.current) {
			return
		}
		const svgEl = containerRef.current.querySelector("svg")
		if (!svgEl) {
			return
		}

		try {
			const pngDataUrl = await svgToPng(svgEl, (isDark ? MERMAID_THEME_DARK : MERMAID_THEME_LIGHT).background)
			FileServiceClient.openImage(StringRequest.create({ value: pngDataUrl })).catch((err) =>
				console.error("Failed to open image:", err),
			)
		} catch (err) {
			console.error("Error converting SVG to PNG:", err)
		}
	}

	const handleCopyCode = async () => {
		try {
			await navigator.clipboard.writeText(code)
		} catch (err) {
			console.error("Copy failed", err)
		}
	}

	return (
		<MermaidBlockContainer>
			{isLoading && <LoadingMessage>Generating mermaid diagram...</LoadingMessage>}
			<ButtonContainer>
				<StyledVSCodeButton aria-label="Copy Code" onClick={handleCopyCode} title="Copy Code">
					<span className="codicon codicon-copy"></span>
				</StyledVSCodeButton>
			</ButtonContainer>
			<SvgContainer $isLoading={isLoading} onClick={handleClick} ref={containerRef} />
		</MermaidBlockContainer>
	)
}

async function svgToPng(svgEl: SVGElement, bgColor: string): Promise<string> {
	console.log("svgToPng function called")
	// Clone the SVG to avoid modifying the original
	const svgClone = svgEl.cloneNode(true) as SVGElement

	// Get the original viewBox
	const viewBox = svgClone.getAttribute("viewBox")?.split(" ").map(Number) || []
	const originalWidth = viewBox[2] || svgClone.clientWidth
	const originalHeight = viewBox[3] || svgClone.clientHeight

	// Calculate the scale factor to fit editor width while maintaining aspect ratio

	// Unless we can find a way to get the actual editor window dimensions through the VS Code API (which might be possible but would require changes to the extension side),
	// the fixed width seems like a reliable approach.
	const editorWidth = 3_600

	const scale = editorWidth / originalWidth
	const scaledHeight = originalHeight * scale

	// Update SVG dimensions
	svgClone.setAttribute("width", `${editorWidth}`)
	svgClone.setAttribute("height", `${scaledHeight}`)

	const serializer = new XMLSerializer()
	const svgString = serializer.serializeToString(svgClone)
	const encoder = new TextEncoder()
	const bytes = encoder.encode(svgString)
	const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
	const svgDataUrl = `data:image/svg+xml;base64,${base64}`

	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			const canvas = document.createElement("canvas")
			canvas.width = editorWidth
			canvas.height = scaledHeight

			const ctx = canvas.getContext("2d")
			if (!ctx) {
				return reject("Canvas context not available")
			}

			// Fill background with the active theme's background color
			ctx.fillStyle = bgColor
			ctx.fillRect(0, 0, canvas.width, canvas.height)

			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"

			ctx.drawImage(img, 0, 0, editorWidth, scaledHeight)
			resolve(canvas.toDataURL("image/png", 1.0))
		}
		img.onerror = reject
		img.src = svgDataUrl
	})
}

const MermaidBlockContainer = styled.div`
	position: relative;
	margin: 8px 0;
`

const ButtonContainer = styled.div`
	position: absolute;
	top: 8px;
	right: 8px;
	z-index: 1;
	opacity: 0.6;
	transition: opacity 0.2s ease;

	&:hover {
		opacity: 1;
	}
`

const LoadingMessage = styled.div`
	padding: 8px 0;
	color: var(--vscode-descriptionForeground);
	font-style: italic;
	font-size: 0.9em;
`

interface SvgContainerProps {
	$isLoading: boolean
}

const SvgContainer = styled.div<SvgContainerProps>`
	opacity: ${(props) => (props.$isLoading ? 0.3 : 1)};
	min-height: 20px;
	transition: opacity 0.2s ease;
	cursor: pointer;
	display: flex;
	justify-content: center;
`

const StyledVSCodeButton = styled(VSCodeButton)`
	padding: 4px;
	height: 24px;
	width: 24px;
	min-width: unset;
	background-color: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-button-border);
	border-radius: 3px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	.codicon {
		font-size: 14px;
	}

	&:hover {
		background-color: var(--vscode-button-secondaryHoverBackground);
		border-color: var(--vscode-button-border);
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	&:active {
		transform: translateY(0);
		box-shadow: none;
	}
`
