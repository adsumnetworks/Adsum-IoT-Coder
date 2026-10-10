import type { Meta, StoryObj } from "@storybook/react-vite"
import ImageModelNotice from "./ImageModelNotice"

/**
 * [P5.1 / P7.7 sessions first] Shown under the composer once an image lands there and the selected
 * model (the free tier's included) cannot read it. The image itself stays in the composer — only this
 * notice, and the link to change model, is new.
 */
const meta: Meta<typeof ImageModelNotice> = {
	title: "Session/ImageModelNotice",
	component: ImageModelNotice,
}

export default meta
type Story = StoryObj<typeof ImageModelNotice>

export const Shown: Story = {
	args: { show: true },
}

export const Hidden: Story = {
	args: { show: false },
}
