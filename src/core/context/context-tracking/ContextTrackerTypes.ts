// Type definitions for FileContextTracker
export interface FileMetadataEntry {
	path: string
	record_state: "active" | "stale"
	record_source: "read_tool" | "user_edited" | "cline_edited" | "file_mentioned"
	cline_read_date: number | null
	cline_edit_date: number | null
	user_edit_date?: number | null
}

export interface ModelMetadataEntry {
	ts: number
	model_id: string
	model_provider_id: string
	mode: string
}

export interface EnvironmentMetadataEntry {
	ts: number
	os_name: string
	os_version: string
	os_arch: string
	host_name: string
	host_version: string
	cline_version: string
}

/**
 * What the HOST decided about this workspace before the first request.
 *
 * [BENCH 2026-09-04, I-31] Two issues had to be judged from the agent's reasoning because nothing
 * recorded what the host actually sent: the transcript shows what the model did, never what it was
 * told. So "was the product row emitted?" was an inference from whether the agent happened to
 * mention the product — which is exactly the kind of evidence that lets a wrong conclusion look
 * settled. One small object turns it into a read.
 */
export interface HostVerdict {
	/** Product id the workspace was recognised as, e.g. "fanstel/lew840x". Null when none matched. */
	product: string | null
	/** Why — the file the marker was found in. Null when nothing matched. */
	product_evidence: string | null
	/** How the workspace classified: nrf / esp / both / none. */
	platform: string
	/** When this verdict was taken. */
	at: string
}

export interface TaskMetadata {
	files_in_context: FileMetadataEntry[]
	model_usage: ModelMetadataEntry[]
	environment_history: EnvironmentMetadataEntry[]
	/** Optional: absent on tasks recorded before this existed. */
	host_verdict?: HostVerdict
}
