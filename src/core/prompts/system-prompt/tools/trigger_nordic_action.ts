import { nrfToolActive } from "@/services/platform/platformRouting"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Device Tool - Execute NCS commands in the nRF Connect terminal,
 * and capture live logs from connected nRF devices.
 *
 * Two modes:
 * 1. action="execute" → Runs any west/nrfjprog/nrfutil command in the nRF Connect terminal
 *    (guarantees correct SDK environment — toolchain, ZEPHYR_BASE, PATH).
 *    Use this for: west build, west flash, nrfutil device list, nrfjprog, etc.
 *
 * 2. action="log_device" → Runs the embedded native logger tool.
 *    Use this for: live UART/RTT log capture only.
 *
 * IMPORTANT: execute_command MUST NOT be used for NCS SDK tasks.
 *            It runs in a plain terminal without the SDK environment.
 */

/**
 * Platform gate (runtime). The nRF tool is advertised when the open workspace is
 * classified nrf, both, or none (the neutral default keeps nRF tooling available);
 * it is hidden in a pure ESP workspace so the prompt never offers a tool the ESP
 * knowledge base doesn't use. Mirrors trigger_esp_action's isEspActive.
 */
const isNrfActive = (): boolean => nrfToolActive(getCachedWorkspaceSummary())

const TECHNICAL_REFERENCE = `
CRITICAL OPERATIONAL RULES:
1. BOARD NAMES: Must be full Zephyr ID (e.g., "nrf52840dk/nrf52840", NOT "nrf52840dk"). Use for example "west boards -f "{name}/{qualifiers}" | grep nrf52840" to verify.
2. BUILD DIRS: User may have custom build dirs (e.g., build_52840, build_central). Use --build-dir (-d) to target them.
3. MULTI-DEVICE FLASH: Use "west flash --snr <serial_number>" to target a specific device. Required when >1 device connected.
4. PROCESS CLEANUP (run before flash or log capture):
   - Linux/Mac: pkill -9 JLink && pkill -9 nrfutil
   - Windows:   cmd /c "taskkill /F /IM JLink.exe 2>nul & taskkill /F /IM nrfutil.exe 2>nul"
     (always wrap in cmd /c — '&' and '2>nul' are cmd.exe syntax, but the user may be in PowerShell, which rejects them; cmd /c "..." makes it portable)
5. PORTS: Windows uses COMx; Linux uses /dev/ttyACMx; Mac uses /dev/tty.usbmodemXXXX.
6. DEVICE LISTING: For device enumeration, use action="log_device" operation="list". NEVER call nrfutil device list via execute_command directly.
`

const PARAMETERS = [
	{
		name: "action",
		required: true,
		instruction: `The action to perform. Options:
- "execute": Run a west/nrfjprog/nrfutil command in the nRF Connect terminal (correct SDK env). Use for ALL NCS CLI operations.
- "log_device": Run the native Nordic Logger tool. Use ONLY for live UART/RTT log capture.`,
		usage: "execute",
	},
	{
		name: "command",
		required: false,
		instruction: `Required if action="execute". The shell command to run in the nRF Connect terminal.
Examples:
- "west boards | grep nrf52840"      (Find correct board name)
- "west build -b nrf52840dk/nrf52840 ."  (Build)
- "west build -d build_52840 --pristine -b nrf52840dk/nrf52840 ."  (Build with custom dir)
- "west flash"                       (Flash single device)
- "west flash --snr 683335182"       (Flash specific device)
- "nrfjprog --recover"
- "nrfutil device list"`,
		usage: "west build -b nrf52840dk/nrf52840 .",
	},
	{
		name: "ncs_version",
		required: false,
		instruction: `Optional. The nRF Connect SDK version to build/flash with, e.g. "v3.2.1".
You normally do NOT set this — the tool auto-resolves the version from the project's existing build,
or uses the only installed version. Set it ONLY when the tool reports that multiple NCS versions are
installed and the project has no build yet: ask the user which to use, then pass it here. The choice is
remembered for this project, so you won't be asked again.`,
		usage: "v3.2.1",
	},
	{
		name: "operation",
		required: false,
		instruction: `Required if action="log_device". Options: "list", "test", "capture", "monitor", "device_info".
- "list": List connected nRF devices
- "test": Quick connection test to a device
- "capture": Capture logs for a specified duration and save to file
- "monitor": Continuous live log monitoring (no file save)
- "device_info": Get detailed device information`,
		usage: "capture",
	},
	{
		name: "transport",
		required: false,
		instruction: `Required if action="log_device". Detect from prj.conf:
- "uart": Serial port communication (COM3, /dev/ttyACM0). DEFAULT if not specified.
- "rtt": J-Link RTT (9-digit serial like 683335182). Only if prj.conf shows CONFIG_USE_SEGGER_RTT=y

EXPLICIT RULE: 
✓ User says "capture UART logs" → MUST set transport="uart"
✓ User says "show logs from RTT" → MUST set transport="rtt"  
✓ prj.conf shows CONFIG_LOG_BACKEND_UART=y → set transport="uart"
✓ prj.conf shows CONFIG_USE_SEGGER_RTT=y → set transport="rtt"
✓ prj.conf does not show any → set transport="uart" (UART is the default).

If unsure, tool auto-detects from prj.conf, but ALWAYS pass explicit transport for clarity.`,
		usage: "uart",
	},
	{
		name: "port",
		required: false,
		instruction: `Required for "test", "capture", "monitor" (unless "devices" is used). 
- For UART: The serial port (e.g. /dev/ttyACM0, COM3, /dev/tty.usbmodem14101).
- For RTT: The J-Link Serial Number (e.g. 683335182). CRITICAL: NEVER pass a COM port or /dev/tty* port when using RTT. RTT strictly uses 9-12 digit J-Link serial numbers.`,
		usage: "/dev/ttyACM0",
	},
	{
		name: "duration",
		required: false,
		instruction: `Optional for "capture". Recording duration in seconds. 
- Quick test: 5 seconds
- Boot capture: 15 seconds  
- Standard: 30 seconds (default)
- Extended: 60+ seconds
Choose based on investigation goal.`,
		usage: "30",
	},
	{
		name: "pre-capture-delay",
		required: false,
		instruction: `Optional for "capture". Delay in seconds before device reset (pre-capture listening phase).
- Use for boot log capture: listeners start BEFORE reset
- Default: 0 (no delay)
- Recommended: 2-3 seconds for boot logs
This ensures complete boot sequence is captured.`,
		usage: "3",
	},
	{
		name: "devices",
		required: false,
		instruction: `Optional for "capture". Multi-device mapping: "label:identifier,label2:identifier2".
The label is used to name the output log file. Use generic labels (device1, device2) when roles are unknown.
Use role-specific labels (central, peripheral) ONLY when the role has been confirmed by project config or log analysis.
- For UART: identifier is the serial port (e.g. "device1:/dev/ttyACM0").
- For RTT: identifier is the serial number (e.g. "device1:683335182"). CRITICAL: NEVER pass a COM port or /dev/tty* port when using RTT. RTT strictly uses 9-12 digit J-Link serial numbers.`,
		usage: "device1:683335182,device2:683007782",
	},
	{
		name: "output",
		required: false,
		instruction: `Optional for "capture". Directory to save logs.`,
		usage: "logs/",
	},
	{
		name: "reset",
		required: false,
		instruction: `Optional. Reset device(s) before capture. DEFAULT: true. Set to false ONLY for mid-runtime capture.`,
		usage: "true",
	},
	{
		name: "auto_detect",
		required: false,
		instruction: `Optional. Auto-detect all connected nRF devices. Set to true for BLE/multi-device scenarios where you want to capture everything without specifying ports.`,
		usage: "true",
	},
	{
		name: "list_nrf",
		required: false,
		instruction: `Optional. When true with operation="list", shows only nRF devices.`,
		usage: "true",
	},
]

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: "triggerNordicAction",
	contextRequirements: isNrfActive,
	description: `Execute commands in the nRF Connect terminal (correct NCS SDK environment), OR capture live logs from connected nRF devices.

USE action="execute" for ALL NCS CLI operations: west build, west flash, nrfjprog, nrfutil, etc.
USE action="log_device" ONLY for live UART/RTT log capture.
NEVER use execute_command for NCS SDK tasks — it runs in a plain terminal without the toolchain.
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	contextRequirements: isNrfActive,
	description: `Execute commands in the nRF Connect terminal (correct NCS SDK environment), OR capture live logs from connected nRF devices.
USE action="execute" for ALL NCS CLI (west, nrfjprog, nrfutil). USE action="log_device" ONLY for log capture. NEVER use execute_command for NCS SDK tasks.
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	contextRequirements: isNrfActive,
	description: `Execute commands in the nRF Connect terminal (correct NCS SDK environment), OR capture live logs from connected nRF devices.
USE action="execute" for ALL NCS CLI (west, nrfjprog, nrfutil). USE action="log_device" ONLY for log capture. NEVER use execute_command for NCS SDK tasks.
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

export const trigger_nordic_action_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
