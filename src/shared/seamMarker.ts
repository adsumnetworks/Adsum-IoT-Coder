/**
 * Round 23 (B33, 14 Sep): the test seam switches on when a workspace root holds `evals.env`. The agent then listed
 * that file and told the developer their project was "an evaluation workspace" answered "from the knowledge base".
 * While the seam is on, the marker is not shown in the file lists the agent reads. No `vscode` import here: the
 * list formatter is used by the standalone core and node tests too.
 */
export const SEAM_MARKER_FILE = "evals.env"

let hidden = false

export function setSeamMarkerHidden(value: boolean): void {
	hidden = value
}

/** True for the seam's marker at the root of a listed folder, while the seam is on. */
export function isHiddenSeamMarker(relativePath: string): boolean {
	return hidden && relativePath === SEAM_MARKER_FILE
}
