import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { chipFamilyList, espChipFamily, nrfChipFamily } from "../chipFamily"

/**
 * The point of this normaliser is that nothing device-specific escapes. A board's serial number, port and
 * revision are all in scope at the call site; only a closed family enum may leave the machine.
 */
describe("chip family normalises to a closed enum", () => {
	test("Nordic families map from nrfutil's deviceFamily", () => {
		assert.equal(nrfChipFamily("NRF52"), "nrf52")
		assert.equal(nrfChipFamily("NRF91"), "nrf91")
		assert.equal(nrfChipFamily("nRF5340"), "nrf53")
		assert.equal(nrfChipFamily("NRF54L"), "nrf54")
	})

	test("Espressif variants beat the bare family", () => {
		assert.equal(espChipFamily("ESP32-S3"), "esp32-s3")
		assert.equal(espChipFamily("ESP32-C6"), "esp32-c6")
		assert.equal(espChipFamily("ESP32"), "esp32")
	})

	test("anything unrecognised collapses to other, never passes through", () => {
		assert.equal(nrfChipFamily("SOME-NEW-PART"), "other")
		assert.equal(espChipFamily("ESP32-X9"), "other")
		// The failure this prevents: an unexpected device turning a closed enum into a free-text field.
		assert.notEqual(nrfChipFamily("PCA10056-SERIAL-683335182"), "PCA10056-SERIAL-683335182")
	})

	test("absent stays absent rather than becoming a bucket", () => {
		assert.equal(nrfChipFamily(undefined), undefined)
		assert.equal(espChipFamily(""), undefined)
	})

	test("the list is deduped, sorted, and drops the unknowns", () => {
		assert.deepEqual(chipFamilyList(["nrf91", "nrf52", "nrf52", undefined]), ["nrf52", "nrf91"])
		assert.deepEqual(chipFamilyList([undefined, undefined]), [])
	})
})
