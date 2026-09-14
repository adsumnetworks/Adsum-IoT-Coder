import type { Meta, StoryObj } from "@storybook/react-vite"
import OpenRouterRouting from "./OpenRouterRouting"

/** The Routing block, at the two widths a settings panel is actually read at. */
const model = { maxTokens: 8192, contextWindow: 128000, supportsImages: false, inputPrice: 0.6, outputPrice: 2.4 } as never

const meta: Meta = { title: "Adsum/Routing", parameters: { layout: "padded" } }
export default meta

const frame = (values: Record<string, unknown>): StoryObj => ({
	render: () => (
		<div style={{ padding: "12px" }}>
			<OpenRouterRouting modelInfo={model} onChange={() => {}} values={values} />
		</div>
	),
})

/** Nothing set: the preference and one quiet opener, which is all most developers need. */
export const Default: StoryObj = frame({})
/** The same configuration with the detail opened by hand. */
export const Opened: StoryObj = {
	render: () => (
		<div style={{ padding: "12px" }}>
			<OpenRouterRouting modelInfo={model} onChange={() => {}} values={{ sellerOrder: "" }} />
		</div>
	),
}
/** Closed, with choices already made: the one line that stops a developer forgetting. */
export const ClosedWithValues: StoryObj = {
	render: () => (
		<div style={{ padding: "12px" }}>
			<OpenRouterRouting
				initialOpen={false}
				modelInfo={model}
				onChange={() => {}}
				values={{
					sellerOrder: "baidu, baseten, parasail",
					onlyTheseSellers: true,
					maxInputPrice: "0.15",
					maxOutputPrice: "0.30",
				}}
			/>
		</div>
	),
}
/** Sellers named: the preference greys out and says why. */
export const WithSellers: StoryObj = frame({ sellerOrder: "together, deepinfra", onlyTheseSellers: true })
/** A ceiling under the live price — the warning that would have saved an evening. */
export const CeilingTooLow: StoryObj = frame({ sellerOrder: "together", maxInputPrice: "0.10", maxOutputPrice: "0.50" })
