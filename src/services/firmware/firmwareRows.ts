/**
 * [0.5 the firmware lane] What one firmware version can do for this developer right now, as the Hardware
 * page draws it: one action per state, never a wall. Pure, so the rules are tested apart from the host.
 *
 *   flash     the files are in the workspace and intact: flash them (an ended term still flashes)
 *   download  the account holds the version's group: Download fetches it, fresh from the server
 *   register  no account yet: a free account is the way in (the demo rungs open on registration)
 *   renew     a production or source rung the account does not hold: a renewal request to the team
 *   ask       anything else the account does not hold: Ask for more details
 */
export type FirmwareRowState = "flash" | "download" | "register" | "renew" | "ask"

export interface RowFacts {
	/** The registry says this account may download it (server-side, from the manifest). */
	entitled: boolean
	/** The rung's entitlement group, e.g. blg20-demo-hex, blg20-prod-hex, lew840x-ble-src. */
	group: string | null
	/** A signed-in account exists on this machine. */
	signedIn: boolean
	/** A receipt for this exact version is in the workspace. */
	local: { intact: boolean } | null
}

const PAID_RUNG = /-src$|-prod-hex$/

export function firmwareRowState(f: RowFacts): FirmwareRowState {
	if (f.local?.intact) {
		return "flash"
	}
	// A folder with a file missing or altered is downloaded again, but only by someone who may.
	if (f.entitled) {
		return "download"
	}
	if (!f.signedIn) {
		return "register"
	}
	return f.group && PAID_RUNG.test(f.group) ? "renew" : "ask"
}
