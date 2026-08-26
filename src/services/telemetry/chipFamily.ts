/**
 * Chip family, reduced to a closed enum for telemetry.
 *
 * The detectors know a lot about a board: serial number, port, board revision, device name. None of that
 * may leave the machine. What is worth knowing is which silicon family is on desks — an nRF91 cellular
 * user and an nRF52 BLE user reported the same `iot_platform: "nrf"` before this, so the adoption of a
 * whole family was invisible.
 *
 * Anything unrecognised collapses to "other" rather than being passed through, so a new or oddly-reported
 * device can never turn into a free-text field.
 */
const NRF_FAMILIES = ["nrf51", "nrf52", "nrf53", "nrf54", "nrf91"] as const
const ESP_FAMILIES = ["esp32", "esp32-s2", "esp32-s3", "esp32-c3", "esp32-c6", "esp32-h2", "esp32-p4"] as const

/** Nordic: `deviceFamily` from `nrfutil device list`, e.g. "NRF52" / "NRF91". Prefix: "NRF5340" is nrf53. */
export function nrfChipFamily(deviceFamily: string | undefined): string | undefined {
	if (!deviceFamily) {
		return undefined
	}
	const v = deviceFamily.toLowerCase().replace(/[^a-z0-9]/g, "")
	const hit = NRF_FAMILIES.find((f) => v.startsWith(f))
	return hit ?? "other"
}

/**
 * Espressif: `chip` from esptool flash_id, e.g. "ESP32-S3".
 *
 * Exact match, not prefix. A Nordic family name really is a prefix of the part ("NRF5340" is nRF53), but an
 * Espressif variant is the whole name — prefix-matching would quietly file an unreleased "ESP32-X9" under
 * plain "esp32" and hide that we had never heard of it. Unknown belongs in "other", where it can be seen.
 */
export function espChipFamily(chip: string | undefined): string | undefined {
	if (!chip) {
		return undefined
	}
	const v = chip.toLowerCase().replace(/[^a-z0-9-]/g, "")
	return (ESP_FAMILIES as readonly string[]).includes(v) ? v : "other"
}

/** Sorted, deduped, undefined dropped — a stable shape for grouping in a query. */
export function chipFamilyList(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((v): v is string => Boolean(v)))].sort()
}
