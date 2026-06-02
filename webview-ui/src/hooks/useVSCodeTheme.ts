import { useEffect, useState } from "react"

const isDark = () =>
	(document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast")) &&
	!document.body.classList.contains("vscode-high-contrast-light")

export const useVSCodeTheme = () => {
	const [dark, setDark] = useState(isDark)

	useEffect(() => {
		const observer = new MutationObserver(() => setDark(isDark()))
		observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
		return () => observer.disconnect()
	}, [])

	return { isDark: dark }
}
