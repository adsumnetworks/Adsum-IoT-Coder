# Telemetry — Adsum IoT Coder

Adsum IoT Coder collects anonymous usage data to help us understand how the extension is used and where it falls short. **No personally identifiable information (PII) is ever collected.**

## Quick facts

- **Backend:** [PostHog](https://posthog.com/) (US cloud — Adsum's own project, not shared with upstream Cline)
- **Identifier:** an anonymous machine ID, never your name, email, or account
- **Geolocation:** disabled at the SDK level — your IP is not used to derive location
- **Two off-switches:** the extension setting `adsum-iot-coder.telemetry.enabled` AND VS Code's global `telemetry.telemetryLevel` — turning **either** off stops all collection

## How to opt out

Either switch disables telemetry entirely. No reload required.

1. **Extension setting**: open VS Code Settings (`Cmd+,` / `Ctrl+,`), search for `adsum-iot-coder.telemetry.enabled`, set to `false`.
2. **VS Code global**: set `telemetry.telemetryLevel` to `"off"`. Also disables VS Code's own telemetry and any other extension that respects the global setting.

## What is collected — categories

| Category | Examples |
|---|---|
| **Lifecycle** | First install + every session start |
| **Authentication** | Sign in / out events (no credentials) |
| **Task lifecycle** | Task created, restarted, completed |
| **Tool usage** | Which tools you invoked (`read_file`, `execute_command`, …) — **not the arguments** |
| **nRF / IoT actions** | `nrf_device_tool` build / flash / capture / monitor operations |
| **Errors** | Provider API errors, tool failures (messages truncated to 500 chars) |
| **Settings / mode** | Plan/Act toggles, model switches, feature toggles |
| **Workspace** | Multi-root initialization, VCS detection (boolean flags only) |
| **Browser, voice, focus chain, checkpoints** | Feature-specific reliability events |

The complete list of event constants is in [`src/services/telemetry/TelemetryService.ts`](src/services/telemetry/TelemetryService.ts) (search for `EVENTS =`) — that's the source of truth.

## What is NOT collected

None of the following are ever sent:

- **File names, paths, or contents** (workspace paths, opened files, source code, log contents)
- **Workspace or folder names**
- **Any text you type** (prompts, chat messages, custom commands, file edits, terminal input)
- **Tool call arguments** beyond the tool name itself (e.g. we record that `read_file` was used, not which file)
- **API keys, tokens, or credentials** of any kind
- **Your IP address or precise location**
- **Account identifiers tied to PII**

If you find an event that you believe leaks any of the above, please open an issue — it's a bug.

## Unique identifier

A stable, anonymous machine ID is generated locally (via `node-machine-id`, with a UUID fallback persisted in VS Code's `globalState`) the first time the extension runs. PostHog uses this ID to distinguish unique users without knowing who you are.

If you sign in to a Cline account, your account ID replaces the anonymous machine ID on the telemetry stream so a single user across multiple machines is counted as one. No additional PII is sent.

## Fork attribution

Every event carries identifiers that let us cleanly distinguish Adsum events from upstream Cline events (in case the same PostHog project is ever shared):

- `extension_name`: `"nrf-ai-debugger"` (Marketplace ID)
- `extension_publisher`: `"AdsumNetwork"`
- `extension_display_name`: `"Adsum IoT Coder – for nRF"`
- `extension_version`: the active version
- `is_fork`: `true`
- `upstream`: `"cline"`
- `platform`, `arch`, `os_type`, `os_version`: standard environment metadata

These are attached both as **PostHog person properties** (queryable in the Person view) and **event properties** (visible on every raw event payload).

## Data deletion

To delete your telemetry data, contact the maintainers at the issue tracker in the [README](README.md). Include your anonymous machine ID — find it by running `Developer: Open Logs Folder` and grepping the extension log for `distinctId`. We'll issue a PostHog deletion request for that ID.

You can also stop future collection by setting `adsum-iot-coder.telemetry.enabled: false` (see "How to opt out" above).
