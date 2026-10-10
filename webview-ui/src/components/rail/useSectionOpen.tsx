import { useCallback, useState } from "react"

const KEY = "adsum.rail.sections"

/**
 * [0.5] Every rail block folds, the way a sidebar section does, and remembers how it was left. Default open;
 * the choice lives in this window's browser storage only (a convenience, never state the host needs).
 */
export function useSectionOpen(id: string, fallback = true): [boolean, () => void] {
	const read = (): boolean => {
		try {
			const map = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, boolean>
			return typeof map[id] === "boolean" ? map[id] : fallback
		} catch {
			return fallback
		}
	}
	const [open, setOpen] = useState<boolean>(read)
	const toggle = useCallback(() => {
		setOpen((v) => {
			const next = !v
			try {
				const map = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, boolean>
				map[id] = next
				localStorage.setItem(KEY, JSON.stringify(map))
			} catch {
				// private window
			}
			return next
		})
	}, [id])
	return [open, toggle]
}

/** The chevron a section label carries. */
export const Chevron = ({ open }: { open: boolean }) => (
	<span
		aria-hidden="true"
		style={{
			display: "inline-block",
			width: 8,
			fontSize: 9,
			lineHeight: 1,
			transform: open ? "rotate(90deg)" : "none",
			transition: "transform .12s",
			color: "var(--vscode-descriptionForeground)",
		}}>
		▶
	</span>
)
