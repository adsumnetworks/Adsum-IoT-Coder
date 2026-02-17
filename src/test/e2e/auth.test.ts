import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Views - Basic Setup Flow", async ({ sidebar }) => {
	console.log("DEBUG: Starting test...")
	// Verify branding content is visible
	await expect(sidebar.getByText("Welcome to nRF AI Debugger")).toBeVisible({ timeout: 30000 })
	console.log("DEBUG: Welcome visible")
})
