import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import {
	allHolders,
	claimPorts,
	heldElsewhereMessage,
	holderOf,
	portsInCommand,
	releaseAll,
	resetPortGuardForTest,
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
