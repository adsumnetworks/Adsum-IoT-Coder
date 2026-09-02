import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

/**
 * Sending a message to a session that is already working.
 *
 * The composer used to go dead the moment a turn started, so the only ways to steer a run were to wait for
 * a question or to cancel it. These two tests cover the whole promise: a message typed mid-run is visibly
 * taken and reaches the agent at its next step, and if the developer stops the run instead, what they had
 * not yet sent comes back to them rather than dying with the turn.
 *
 * The mock server recognises `[queue.test]` and answers the first turn WITHOUT attempt_completion, so the
 * task loop makes a second request — that second request is the turn boundary where delivery happens.
 */

e2e("Queue - a message sent mid-run is delivered at the agent's next step", async ({ helper, sidebar }) => {
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Check the gateway [queue.test]")
	await sidebar.getByTestId("send-button").click()

	// The run is working: Stop is offered, and — the point of this feature — the box still takes input.
	await expect(sidebar.getByTestId("stop-button")).toBeVisible()
	await expect(inputbox).toHaveValue("")

	await inputbox.fill("also check the LED")
	await sidebar.getByTestId("send-button").click()

	// Taken, and visibly so: the row says the message is waiting, and the box is clear for another.
	const queuedRow = sidebar.getByTestId("queued-message")
	await expect(queuedRow).toBeVisible()
	await expect(queuedRow).toContainText("also check the LED")
	await expect(queuedRow).toContainText("delivers with the agent's next step")
	await expect(inputbox).toHaveValue("")
	// Stopping and sending are separate actions, and both are available at once.
	await expect(sidebar.getByTestId("stop-button")).toBeVisible()

	// At the next turn the waiting row becomes a real message in the conversation.
	await expect(queuedRow).toBeHidden({ timeout: 30_000 })
	await expect(sidebar.getByText("also check the LED")).toBeVisible()
})

e2e("Queue - stopping a run hands back what was not delivered", async ({ helper, sidebar }) => {
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Check the gateway [queue.test]")
	await sidebar.getByTestId("send-button").click()

	await expect(sidebar.getByTestId("stop-button")).toBeVisible()
	await inputbox.fill("this one never goes in")
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByTestId("queued-message")).toBeVisible()

	// Stopping is not a decision to discard what you were about to say.
	await sidebar.getByTestId("stop-button").click()
	await expect(inputbox).toHaveValue("this one never goes in", { timeout: 30_000 })
})
