/**
 * Adsum brand palette — Direction A (dual-brand).
 *
 * Single source of truth for inline-style usage (cards/buttons that can't use
 * Tailwind utilities). CSS-variable equivalents live in `theme.css`
 * (`--color-brand-*`) and Tailwind exposes them as `brand-*` utilities.
 *
 * Centered on the logo cyan (#00A9CE). Cyan leads primary actions/demo;
 * coral carries secondary cards & accents.
 */

// Primary — Adsum Cyan
export const BRAND_CYAN_300 = "#6FD2E6" // light
export const BRAND_CYAN_500 = "#19B6D8" // hover
export const BRAND_CYAN_600 = "#00A9CE" // base (logo)
export const BRAND_CYAN_700 = "#0089A8" // active / text-on-fill safe

// Secondary — Adsum Coral
export const BRAND_CORAL = "#D76947" // base
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
