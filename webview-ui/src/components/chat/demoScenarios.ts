/**
 * Pre-captured demo scenario data, embedded at build time.
 *
 * Scenario L3-T1: BLE NUS one-directional communication bug.
 * Two nRF52840 DKs — Central sends fine, Peripheral replies fail silently.
 * Root cause: missing bt_gatt_subscribe in discovery_complete.
 */

export interface DemoScenario {
	id: string
	title: string
	honestLabel: string
	taskPrompt: string
}

const CENTRAL_LOG = `[00:00:00.000,000] <inf> bt_hci_core: HW Platform: Nordic Semiconductor (0x0002)
[00:00:00.000,000] <inf> bt_hci_core: HW Variant: nRF52840 (0x0008)
[00:00:00.001,000] <inf> bt_hci_core: Firmware: Standard Bluetooth controller (0x00) Version 3.3 Build 99
[00:00:00.100,000] <inf> main: Starting BLE NUS Central
[00:00:00.110,000] <inf> main: Bluetooth initialized
[00:00:00.120,000] <inf> main: Scanning started
[00:00:02.340,000] <inf> scan_cb: Found device Nordic_NUS_Periph addr=E4:F3:A2:11:22:33
[00:00:02.350,000] <inf> main: Connecting to Nordic_NUS_Periph
[00:00:02.580,000] <inf> main: Connected to E4:F3:A2:11:22:33
[00:00:02.590,000] <inf> gatt_discover_cb: Starting service discovery
[00:00:02.610,000] <inf> gatt_discover_cb: NUS service found, handle=0x0010
[00:00:02.620,000] <inf> gatt_discover_cb: NUS TX characteristic found, handle=0x0012
[00:00:02.630,000] <inf> gatt_discover_cb: NUS RX characteristic found, handle=0x0015
[00:00:02.640,000] <inf> gatt_discover_cb: Discovery complete
[00:00:03.000,000] <inf> main: Sending "Hello from Central" to peripheral
[00:00:03.010,000] <inf> nus_client_send: Write to RX characteristic succeeded
[00:00:05.000,000] <inf> main: Sending "ping" to peripheral
[00:00:05.010,000] <inf> nus_client_send: Write to RX characteristic succeeded
[00:00:07.000,000] <wrn> main: No response received from peripheral (waited 4s)
[00:00:09.000,000] <inf> main: Sending "ping" to peripheral
[00:00:09.010,000] <inf> nus_client_send: Write to RX characteristic succeeded
[00:00:11.000,000] <wrn> main: No response received from peripheral (waited 4s)
[00:00:13.000,000] <inf> main: Sending "ping" to peripheral
[00:00:13.010,000] <inf> nus_client_send: Write to RX characteristic succeeded
[00:00:15.000,000] <wrn> main: No response received from peripheral (waited 4s)`

const PERIPHERAL_LOG = `[00:00:00.000,000] <inf> bt_hci_core: HW Platform: Nordic Semiconductor (0x0002)
[00:00:00.000,000] <inf> bt_hci_core: HW Variant: nRF52840 (0x0008)
[00:00:00.001,000] <inf> bt_hci_core: Firmware: Standard Bluetooth controller (0x00) Version 3.3 Build 99
[00:00:00.100,000] <inf> main: Starting BLE NUS Peripheral
[00:00:00.110,000] <inf> main: Bluetooth initialized
[00:00:00.120,000] <inf> main: Advertising started as "Nordic_NUS_Periph"
[00:00:02.580,000] <inf> connected_cb: Connected to E8:B2:44:AA:BB:CC (Central)
[00:00:03.010,000] <inf> nus_receive_cb: Received "Hello from Central" from central
[00:00:03.020,000] <inf> nus_send_cb: Sending "ACK: Hello from Central" to central
[00:00:03.030,000] <err> nus_send_cb: bt_nus_send failed, err=-5 (ENOTCONN)
[00:00:05.010,000] <inf> nus_receive_cb: Received "ping" from central
[00:00:05.020,000] <inf> nus_send_cb: Sending "pong" to central
[00:00:05.030,000] <err> nus_send_cb: bt_nus_send failed, err=-5 (ENOTCONN)
[00:00:09.010,000] <inf> nus_receive_cb: Received "ping" from central
[00:00:09.020,000] <inf> nus_send_cb: Sending "pong" to central
[00:00:09.030,000] <err> nus_send_cb: bt_nus_send failed, err=-5 (ENOTCONN)
[00:00:13.010,000] <inf> nus_receive_cb: Received "ping" from central
[00:00:13.020,000] <inf> nus_send_cb: Sending "pong" to central
[00:00:13.030,000] <err> nus_send_cb: bt_nus_send failed, err=-5 (ENOTCONN)`

const SOURCE_SNIPPET = `/*
 * central/src/main.c — discovery_complete callback (excerpt)
 */
static uint8_t discovery_complete(struct bt_gatt_dm *dm, void *ctx)
{
    const struct bt_gatt_dm_attr *attr;
    int err;

    LOG_INF("Discovery complete");

    attr = bt_gatt_dm_char_by_uuid(dm, BT_UUID_NUS_TX);
    if (!attr) {
        LOG_ERR("NUS TX characteristic not found");
        return BT_GATT_ITER_STOP;
    }
    nus_handles.tx = bt_gatt_dm_attr_chrc_val(attr)->handle;

    attr = bt_gatt_dm_char_by_uuid(dm, BT_UUID_NUS_RX);
    if (!attr) {
        LOG_ERR("NUS RX characteristic not found");
        return BT_GATT_ITER_STOP;
    }
    nus_handles.rx = bt_gatt_dm_attr_chrc_val(attr)->handle;

    /* NOTE: subscription to TX notifications is intentionally omitted here */

    err = bt_gatt_dm_data_release(dm);
    if (err) {
        LOG_ERR("Failed to release discovery data: %d", err);
    }

    k_sem_give(&gatt_discovery_done);
    return BT_GATT_ITER_STOP;
}`

function buildDemoPrompt(): string {
	return `[ADSUM_DEMO:l3-t1] You are running the Adsum IoT Coder one-click demo. Analyze the pre-captured BLE RTT logs below and find the root cause of the one-directional NUS communication bug. No hardware is needed — the logs were captured from a real nRF52840 setup.

--- Central device RTT log ---
${CENTRAL_LOG}

--- Peripheral device RTT log ---
${PERIPHERAL_LOG}

--- Buggy source snippet: central/src/main.c (discovery_complete callback) ---
${SOURCE_SNIPPET}

Your task:
1. State the symptom clearly (what the logs show is going wrong)
2. Identify the root cause with a reference to the source code
3. Show the exact fix as a code snippet
4. Explain in one sentence why the fix works

Be direct and educational — you're helping a developer understand a real nRF bug.

End your final message with exactly: <!--TASK_COMPLETE-->

After the marker, add one line: "Your turn — ask me anything about this bug, or connect your own board to debug a live issue."`
}

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
	"l3-t1": {
		id: "l3-t1",
		title: "BLE NUS one-directional communication",
		honestLabel: "Logs pre-captured for this demo — connect a board to capture live.",
		taskPrompt: buildDemoPrompt(),
	},
}

export const DEFAULT_DEMO_SCENARIO_ID = "l3-t1"
