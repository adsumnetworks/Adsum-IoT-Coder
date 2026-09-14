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

/** Nothing set: exactly what an existing configuration does today. */
export const Default: StoryObj = frame({})
/** Sellers named: the preference greys out and says why. */
export const WithSellers: StoryObj = frame({ sellerOrder: "together, deepinfra", onlyTheseSellers: true })
/** A ceiling under the live price — the warning that would have saved an evening. */
export const CeilingTooLow: StoryObj = frame({ sellerOrder: "together", maxInputPrice: "0.10", maxOutputPrice: "0.50" })
