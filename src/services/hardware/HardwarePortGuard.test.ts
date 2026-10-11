import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import {
	allHolders,
	claimPorts,
	continueRoute,
	heldElsewhereMessage,
	holderOf,
	isParkedOnWords,
	portsInCommand,
	releaseAll,
	releaseWhenParked,
	rememberUnitSession,
	resetPortGuardForTest,
	sessionForUnit,
} from "./HardwarePortGuard"

/**
 * One bench, several session tabs. Run:
 *   npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/hardware/HardwarePortGuard.test.ts
 */
describe("portsInCommand — the ports a command names", () => {
	test("macOS tty and cu are the same port, upper-cased once", () => {
		assert.deepEqual(portsInCommand("python3 logger.py --port /dev/cu.usbmodem2861"), ["/DEV/TTY.USBMODEM2861"])
		assert.deepEqual(portsInCommand("cat /dev/tty.usbmodem2861"), ["/DEV/TTY.USBMODEM2861"])
	})
	test("Linux ACM and Windows COM ports", () => {
		assert.deepEqual(portsInCommand("esptool.py --port /dev/ttyACM0 flash_id").sort(), ["/DEV/TTYACM0"])
		assert.deepEqual(portsInCommand("esptool.py --port COM7 flash_id"), ["COM7"])
	})
	test("a J-Link serial counts only beside a probe tool", () => {
		assert.deepEqual(portsInCommand("nrfutil device program --serial-number 683335182 --firmware a.hex"), ["683335182"])
		assert.deepEqual(portsInCommand("echo 683335182"), [])
	})
	test("a gateway over Bluetooth is held by its four digits, however the command names it", () => {
		assert.deepEqual(portsInCommand("blg20-service passport --ble AD50 --json"), ["BLE:AD50"])
		assert.deepEqual(portsInCommand("blg20-service update-ble --ble D3588E7AAD50 a.bin"), ["BLE:AD50"])
		assert.deepEqual(portsInCommand("blg20-service health --ble=D3:58:8E:7A:AD:50"), ["BLE:AD50"])
		assert.deepEqual(portsInCommand("blg20-service list --ble --json"), ["BLE:ANY"])
		assert.deepEqual(portsInCommand("blg20-service update-pair --ble firmware/lbg20x/1.0.0/usb/demo"), ["BLE:ANY"])
	})
	test("no port, no claim", () => {
		assert.deepEqual(portsInCommand("west build -b nrf52840dk"), [])
	})
})

describe("claimPorts — the holder is named, never fought", () => {
	beforeEach(() => resetPortGuardForTest())

	test("the first session claims, the second is told who holds it", () => {
		const a = { taskId: "A", title: "LEW840x gateway build", since: 1 }
		const b = { taskId: "B", title: "BLG20x set up", since: 2 }
		assert.deepEqual(claimPorts(["/DEV/TTYACM0"], a), [])
		const others = claimPorts(["/DEV/TTYACM0"], b)
		assert.equal(others.length, 1)
		assert.equal(others[0].taskId, "A")
		assert.match(heldElsewhereMessage(others), /LEW840x gateway build/)
		assert.match(heldElsewhereMessage(others), /never end another session's process/)
	})
	test("the same session may claim again; release frees everything it held", () => {
		const a = { taskId: "A", title: "one", since: 1 }
		claimPorts(["COM7", "COM8"], a)
		assert.deepEqual(claimPorts(["COM7"], a), [])
		assert.equal(allHolders().length, 2)
		releaseAll("A")
		assert.equal(allHolders().length, 0)
		assert.equal(holderOf("COM7"), undefined)
	})
	test("holderOf normalises cu to tty", () => {
		claimPorts(["/DEV/TTY.USBMODEM1"], { taskId: "A", title: "one", since: 1 })
		assert.equal(holderOf("/dev/cu.usbmodem1")?.taskId, "A")
	})
})

describe("a parked session lets go (11 Oct 2026, the bench)", () => {
	beforeEach(() => resetPortGuardForTest())
	const a = { taskId: "A", title: "What is this gateway? · LBG20x AD50", since: 1 }
	const b = { taskId: "B", title: "Logs · LBG20x AD50", since: 2 }

	test("a session waiting on a question frees the unit: the next tab is not refused", () => {
		claimPorts(["BLE:AD50"], a)
		assert.equal(releaseWhenParked("A", "followup", 0), true)
		assert.deepEqual(claimPorts(["BLE:AD50"], b), [])
	})
	test("done, a plan answer and a resume are parked too", () => {
		for (const ask of [
			"completion_result",
			"plan_mode_respond",
			"act_mode_respond",
			"resume_task",
			"resume_completed_task",
		]) {
			claimPorts(["COM7"], a)
			assert.equal(releaseWhenParked("A", ask, 0), true, ask)
			assert.equal(holderOf("COM7"), undefined, ask)
		}
	})
	test("a session waiting on a command approval keeps its hold", () => {
		claimPorts(["BLE:AD50"], a)
		assert.equal(releaseWhenParked("A", "command", 0), false)
		assert.equal(releaseWhenParked("A", "tool", 0), false)
		assert.equal(claimPorts(["BLE:AD50"], b).length, 1)
	})
	test("a command still running in its terminal keeps the hold, even at a question", () => {
		claimPorts(["/DEV/TTYACM0"], a)
		assert.equal(releaseWhenParked("A", "followup", 1), false)
		assert.equal(holderOf("/dev/ttyACM0")?.taskId, "A")
	})
})

describe("a button for a unit continues in the session that works with it", () => {
	beforeEach(() => resetPortGuardForTest())

	test("the holder is the session; after it lets go it is still the one that last worked with the unit", () => {
		claimPorts(["BLE:AD50"], { taskId: "A", title: "one", since: 1 })
		assert.equal(sessionForUnit("BLE:AD50"), "A")
		releaseAll("A")
		assert.equal(sessionForUnit("ble:ad50"), "A")
		assert.equal(sessionForUnit("BLE:286C"), undefined)
	})
	test("a session opened by a button is remembered before it ran any command (USB names no port)", () => {
		rememberUnitSession("/dev/ttyACM4", "B")
		assert.equal(sessionForUnit("/DEV/TTYACM4"), "B")
		rememberUnitSession("/dev/cu.usbmodem1", "C")
		assert.equal(sessionForUnit("/dev/tty.usbmodem1"), "C")
	})
	test("the newest session for a unit wins", () => {
		rememberUnitSession("BLE:AD50", "A")
		claimPorts(["BLE:AD50"], { taskId: "B", title: "two", since: 2 })
		assert.equal(sessionForUnit("BLE:AD50"), "B")
	})
})

describe("continueRoute — how a request reaches an open session", () => {
	test("waiting on words: the request is the answer", () => {
		for (const ask of ["followup", "completion_result", "resume_task", "resume_completed_task", "plan_mode_respond"]) {
			assert.equal(continueRoute({ type: "ask", ask }, false), "answer", ask)
		}
	})
	test("waiting on a yes or no for a command or a tool: nothing is sent, words there mean no", () => {
		for (const ask of ["command", "tool", "use_mcp_server", "browser_action_launch", "mistake_limit_reached"]) {
			assert.equal(continueRoute({ type: "ask", ask }, false), "approval", ask)
		}
	})
	test("working: the request waits its turn", () => {
		assert.equal(continueRoute({ type: "say", ask: undefined }, true), "queue")
		assert.equal(continueRoute({ type: "ask", ask: "followup", partial: true }, false), "queue")
		assert.equal(continueRoute({ type: "ask", ask: "followup" }, true), "queue")
		assert.equal(continueRoute({ type: "ask", ask: "command_output" }, false), "queue")
		assert.equal(continueRoute(undefined, false), "queue")
	})
})

describe("isParkedOnWords — nothing in flight, nothing to approve", () => {
	test("a question or a finished session is parked", () => {
		assert.equal(isParkedOnWords({ type: "ask", ask: "followup" }, false), true)
		assert.equal(isParkedOnWords({ type: "ask", ask: "completion_result" }, false), true)
	})
	test("working, a half-written question, an approval or no message at all is not", () => {
		assert.equal(isParkedOnWords({ type: "say" }, true), false)
		assert.equal(isParkedOnWords({ type: "ask", ask: "followup", partial: true }, false), false)
		assert.equal(isParkedOnWords({ type: "ask", ask: "command" }, false), false)
		assert.equal(isParkedOnWords(undefined, false), false)
	})
})
