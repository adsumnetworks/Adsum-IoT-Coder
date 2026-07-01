/**
 * Adsum brand palette — Direction A (dual-brand).
 *
 * Single source of truth for inline-style usage (cards/buttons that can't use
 * Tailwind utilities). CSS-variable equivalents live in `theme.css`
 * (`--color-brand-*`) and Tailwind exposes them as `brand-*` utilities.
 *
 * UI GOLDEN RULES (./UI-GOLDEN-RULES.md): **Coral = identity, Cyan = action.**
 * The logo brandmark is CORAL; coral carries identity + secondary/supporting surfaces (never the focal CTA).
 * Cyan is the interactive layer — the focal action + every affordance (buttons, links, New badge, active state).
 * One feature keeps one action-color across all surfaces. Grey = inactive; semantic = status only (never a verdict).
 */

// Action / interactive — Adsum Cyan
export const BRAND_CYAN_300 = "#6FD2E6" // light — text on dark fills
export const BRAND_CYAN_500 = "#19B6D8" // hover
export const BRAND_CYAN_600 = "#00A9CE" // base — primary ACTION color
export const BRAND_CYAN_700 = "#0089A8" // active / text-on-fill safe

// Identity / secondary — Adsum Coral
export const BRAND_CORAL = "#D76947" // base — IDENTITY (the logo mark) + secondary/supporting
export const BRAND_CORAL_HOVER = "#E07D5F"
export const BRAND_CORAL_ACTIVE = "#C0542F"

// Semantic
export const BRAND_SUCCESS = "#2EA043"
export const BRAND_WARNING = "#D29922"
export const BRAND_ERROR = "#F85149"

/** Subtle tint of a brand color over the VS Code input background. */
export const brandSubtle = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, var(--vscode-input-background))`

/** Translucent brand color (e.g. for borders/shadows). */
export const brandAlpha = (hex: string, alpha: number) => {
	const n = hex.replace("#", "")
	const r = parseInt(n.slice(0, 2), 16)
	const g = parseInt(n.slice(2, 4), 16)
	const b = parseInt(n.slice(4, 6), 16)
	return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
