import { Logger } from "@/services/logging/Logger"

/**
 * What a window says when the browser's sign-in link lands in it but the sign-in was started somewhere else
 * (another window, another profile). Nothing is exchanged there, and nothing needs doing: the window that
 * started the sign-in is polling and finishes it. So at most a quiet status line — never an error.
 *
 * The editor host installs the real surface; without one (a test, a standalone host) it only logs.
 */
export const SIGN_IN_ELSEWHERE_TEXT = "Finishing sign-in in the window that started it"

let surface: ((text: string) => void) | undefined

export function setSignInElsewhereSurface(next: ((text: string) => void) | undefined): void {
	surface = next
}

export function signInElsewhereNotice(): void {
	Logger.info("[account] sign-in callback for a sign-in started in another window — left for that window")
	try {
		surface?.(SIGN_IN_ELSEWHERE_TEXT)
	} catch {
		/* a status line that cannot show is not a reason to fail anything */
	}
}
