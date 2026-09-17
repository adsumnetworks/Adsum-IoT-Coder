import type { ModelInfo } from "@shared/api"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"

/**
 * Routing — who serves this model, and on what terms.
 *
 * A developer with their own key is buying from a market. Three things we learned the hard way, each
 * of which this block exists to make visible: a sort field silently overrides the tail of an order
 * list; a price ceiling can exclude the very fallback you named; and with substitutions allowed the
 * router hands traffic to whoever is cheapest at that second, reduced-precision copies included.
 *
 * The words here are the developer's — sellers, price you accept, tool calls. The API's field names
 * (provider.order, allow_fallbacks, max_price, require_parameters) appear only in the code that
 * builds the request, so nobody has to learn a vendor's vocabulary to make a decision about money.
 *
 * CLOSED BY DEFAULT, and this is the point: most developers want a key, a model and one preference,
 * and six controls in front of all of them is the opposite of simple. What is set stays set while the
 * section is closed — the values live in the configuration, not in this component, and the request
 * keeps sending them — because a hidden setting that silently stops applying would be worse than no
 * setting at all. When anything IS set, the closed state says so in one line, so nobody forgets that
 * their traffic is pinned to one seller.
 */

export interface RoutingValues {
	sellerOrder?: string
	onlyTheseSellers?: boolean
	maxInputPrice?: string
	maxOutputPrice?: string
	requireToolCalls?: boolean
	extraBody?: string
	sorting?: string
}

interface OpenRouterRoutingProps {
	values: RoutingValues
	onChange: (field: keyof RoutingValues, value: string | boolean) => void
	/** The chosen model's live price, per million tokens, shown beside the ceiling. */
	modelInfo?: ModelInfo
	/** Stories and tests only: the state to start in. Real use decides from the values themselves. */
	initialOpen?: boolean
}

const Label: React.FC<{ children: React.ReactNode; htmlFor?: string }> = ({ children, htmlFor }) => (
	<label htmlFor={htmlFor} style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "3px" }}>
		{children}
	</label>
)

const Hint: React.FC<{ children: React.ReactNode; tone?: "normal" | "warn" }> = ({ children, tone = "normal" }) => (
	<p
		style={{
			fontSize: "11px",
			lineHeight: 1.5,
			margin: "3px 0 0",
			color: tone === "warn" ? "var(--vscode-editorWarning-foreground)" : "var(--vscode-descriptionForeground)",
		}}>
		{children}
	</p>
)

const price = (perMillion?: number): string | undefined =>
	typeof perMillion === "number" && perMillion > 0 ? `$${perMillion.toFixed(2)}/M` : undefined

/** What is set, in a few words. Empty when nothing is set — silence is the honest default. */
export function routingSummary(values: RoutingValues): string {
	const parts: string[] = []
	const sellers = (values.sellerOrder ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
	if (sellers.length > 0) {
		parts.push(`${sellers.length} seller${sellers.length === 1 ? "" : "s"} named`)
	}
	if (values.onlyTheseSellers) {
		parts.push("no substitutes")
	}
	if ((values.maxInputPrice ?? "").trim() !== "" || (values.maxOutputPrice ?? "").trim() !== "") {
		parts.push("price capped")
	}
	if (values.requireToolCalls === false) {
		parts.push("tool support not required")
	}
	if ((values.extraBody ?? "").trim() !== "") {
		parts.push("extra request body")
	}
	return parts.join(" · ")
}

/** True when this configuration already carries routing choices, so the section opens on them. */
export function hasRoutingValues(values: RoutingValues): boolean {
	return routingSummary(values).length > 0
}

/** The fields a person types into, as opposed to the checkboxes and the preference. */
type TypedField = "sellerOrder" | "maxInputPrice" | "maxOutputPrice" | "extraBody"

export const OpenRouterRouting: React.FC<OpenRouterRoutingProps> = ({ values, onChange, modelInfo, initialOpen }) => {
	// Opens on values that already exist — a developer must not lose sight of a choice made an hour
	// ago — and otherwise stays shut.
	const [open, setOpen] = useState(() => initialOpen ?? hasRoutingValues(values))

	// [15 Sep 2026] What a person types is what the field shows, immediately.
	//
	// Each keystroke sends the WHOLE configuration to the host and the host pushes it back
	// (`handleFieldChange` → `updateApiConfigurationProto` → state); these fields read that returned
	// value, so every character waited on a round trip, and a busy host — a task streaming in the
	// same window — meant characters vanished as they were typed. The block could not be edited at
	// all. The typing is held here until the configuration agrees with it, so the write is still the
	// configuration's and a change made anywhere else still lands in the field.
	const [draft, setDraft] = useState<Partial<Record<TypedField, string>>>({})
	React.useEffect(() => {
		setDraft((d) => {
			const kept = Object.fromEntries(Object.entries(d).filter(([k, v]) => values[k as TypedField] !== v))
			return Object.keys(kept).length === Object.keys(d).length ? d : kept
		})
	}, [values])
	const shown = (field: TypedField): string => draft[field] ?? values[field] ?? ""
	const typed = (field: TypedField) => (value: string) => {
		setDraft((d) => ({ ...d, [field]: value }))
		onChange(field, value)
	}
	const summary = routingSummary(values)
	const sellers = (values.sellerOrder ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
	const hasSellerList = sellers.length > 0
	const inputCeiling = Number(values.maxInputPrice)
	const outputCeiling = Number(values.maxOutputPrice)
	const liveIn = modelInfo?.inputPrice
	const liveOut = modelInfo?.outputPrice
	// The warning that would have saved the evening: a ceiling under the live price means the router
	// never chooses this model, and nothing anywhere says so.
	const underInput = values.maxInputPrice !== "" && Number.isFinite(inputCeiling) && !!liveIn && inputCeiling < liveIn
	const underOutput = values.maxOutputPrice !== "" && Number.isFinite(outputCeiling) && !!liveOut && outputCeiling < liveOut

	const preference = (
		<div style={{ opacity: hasSellerList ? 0.5 : 1 }}>
			<Label htmlFor="routing-sort">When no list is set, prefer</Label>
			<VSCodeDropdown
				data-testid="routing-sort"
				disabled={hasSellerList}
				id="routing-sort"
				onChange={(e: any) => onChange("sorting", e.target.value)}
				style={{ width: "100%" }}
				value={values.sorting || ""}>
				<VSCodeOption value="">Balanced</VSCodeOption>
				<VSCodeOption value="price">Lowest price</VSCodeOption>
				<VSCodeOption value="throughput">Fastest throughput</VSCodeOption>
				<VSCodeOption value="latency">Lowest latency</VSCodeOption>
			</VSCodeDropdown>
			{hasSellerList && (
				<Hint>
					<span data-testid="routing-sort-reason">
						Not used while you have named sellers — it would reorder everything after them.
					</span>
				</Hint>
			)}
		</div>
	)

	return (
		<div
			data-testid="openrouter-routing"
			style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
			{preference}

			<div>
				<button
					data-testid="routing-toggle"
					onClick={() => setOpen((v) => !v)}
					style={{
						background: "none",
						border: "none",
						padding: 0,
						cursor: "pointer",
						fontSize: "12px",
						fontWeight: 600,
						color: "var(--vscode-textLink-foreground)",
						textAlign: "left",
					}}
					type="button">
					{open ? "▾" : "▸"} Choose your sellers
				</button>
				<Hint>Pick who serves this model, cap what you pay, require tool support.</Hint>
				{!open && summary && (
					<Hint>
						<span data-testid="routing-summary" style={{ color: "var(--vscode-foreground)" }}>
							{summary}
						</span>
					</Hint>
				)}
			</div>

			{!open ? null : (
				<>
					<div>
						<Label htmlFor="routing-sellers">Sellers to use, in order</Label>
						<VSCodeTextField
							data-testid="routing-sellers"
							id="routing-sellers"
							onInput={(e: any) => typed("sellerOrder")(e.target.value)}
							placeholder="e.g. together, deepinfra"
							style={{ width: "100%" }}
							value={shown("sellerOrder")}
						/>
						<Hint>Separate names with commas. The first that can serve the model gets the request.</Hint>
					</div>

					<div>
						<VSCodeCheckbox
							checked={!!values.onlyTheseSellers}
							data-testid="routing-only-these"
							onChange={(e: any) => onChange("onlyTheseSellers", e.target.checked)}>
							Only these sellers
						</VSCodeCheckbox>
						<Hint>
							With this off, the router may pick any seller of this model — including reduced-precision copies.
						</Hint>
					</div>

					<div>
						<Label>Highest price you accept</Label>
						<div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
							<VSCodeTextField
								data-testid="routing-max-input"
								onInput={(e: any) => typed("maxInputPrice")(e.target.value)}
								placeholder="input $/M"
								style={{ flex: "1 1 120px" }}
								value={shown("maxInputPrice")}
							/>
							<VSCodeTextField
								data-testid="routing-max-output"
								onInput={(e: any) => typed("maxOutputPrice")(e.target.value)}
								placeholder="output $/M"
								style={{ flex: "1 1 120px" }}
								value={shown("maxOutputPrice")}
							/>
						</div>
						<Hint>
							<span data-testid="routing-live-price">
								This model now: {price(liveIn) ?? "—"} in, {price(liveOut) ?? "—"} out.
							</span>{" "}
							Per million tokens. Leave empty for no ceiling.
						</Hint>
						{(underInput || underOutput) && (
							<Hint tone="warn">
								<span data-testid="routing-ceiling-warning">
									Your ceiling is below this model's current price, so the router would skip it.
								</span>
							</Hint>
						)}
					</div>

					<div>
						<VSCodeCheckbox
							checked={values.requireToolCalls !== false}
							data-testid="routing-require-tools"
							onChange={(e: any) => onChange("requireToolCalls", e.target.checked)}>
							Only sellers that support tool calls
						</VSCodeCheckbox>
						<Hint>A seller without them can answer, but cannot run anything.</Hint>
					</div>

					<div>
						<Label htmlFor="routing-extra">Advanced: extra request body</Label>
						<textarea
							data-testid="routing-extra"
							id="routing-extra"
							onChange={(e) => typed("extraBody")(e.target.value)}
							placeholder='{"reasoning_effort": "high"}'
							rows={3}
							style={{
								width: "100%",
								fontFamily: "var(--vscode-editor-font-family)",
								fontSize: "11px",
								background: "var(--vscode-input-background)",
								color: "var(--vscode-input-foreground)",
								border: "1px solid var(--vscode-input-border, transparent)",
								borderRadius: "3px",
								padding: "6px",
							}}
							value={shown("extraBody")}
						/>
						<Hint>Merged last. The model and your messages are never changed by it.</Hint>
					</div>
				</>
			)}
		</div>
	)
}

export default OpenRouterRouting
