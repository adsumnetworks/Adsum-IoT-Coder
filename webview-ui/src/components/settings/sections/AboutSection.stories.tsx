import type { Meta, StoryObj } from "@storybook/react-vite"
import AboutSection from "./AboutSection"

/** The About page on its own, both themes — it has no state to mock. */
const meta: Meta<typeof AboutSection> = {
	title: "Settings/About",
	component: AboutSection,
	parameters: { layout: "fullscreen" },
	args: { version: "0.3.2", renderSectionHeader: () => null },
}
export default meta
export const About: StoryObj<typeof AboutSection> = {}
