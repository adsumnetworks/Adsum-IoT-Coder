// Registry of bundled images the AGENT may surface inline in chat.
//
// The agent emits a controlled marker — `![alt](adsum-asset:<key>)` — and MarkdownBlock renders ONLY
// keys found here (a whitelist; arbitrary remote/file images are never rendered from agent text). Keep
// this small and intentional; each entry is a bundled, offline-safe data URI.

import { nrf52840DongleDfu } from "./nrf52840dongleDfuImage"

export const AGENT_ASSET_SCHEME = "adsum-asset:"

export interface AgentImage {
	src: string
	alt: string
	maxWidth: number
}

export const AGENT_IMAGES: Record<string, AgentImage> = {
	"nrf52840dongle-dfu": {
		src: nrf52840DongleDfu,
		alt: "nRF52840 Dongle — plug in, press the RESET button, LD2 pulses red to enter DFU mode",
		maxWidth: 440,
	},
}

/** Resolve an `adsum-asset:<key>` URL to a bundled image, or null if it isn't a known agent asset. */
export function resolveAgentImage(src: string | undefined): AgentImage | null {
	if (!src || !src.startsWith(AGENT_ASSET_SCHEME)) {
		return null
	}
	return AGENT_IMAGES[src.slice(AGENT_ASSET_SCHEME.length)] ?? null
}
