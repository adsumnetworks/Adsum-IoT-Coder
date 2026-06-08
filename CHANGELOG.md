# Changelog

All notable changes to the **Adsum IoT Coder** extension will be documented in this file.

## [0.1.5] - 2026-06-08

### A full UI redesign — rebuilt around how you start

Early users told us the hardest part wasn't the agent, it was the cold start. So we rebuilt the entire first-run experience: see it work *before* any setup, land on something useful immediately, and always have a clear next step.

- **See it debug a real bug — in 30 seconds, before you set anything up.** A new first-run demo debugs a real BLE bug on firmware bundled with the extension — capture → analyze → fix on a genuine failure, with no board, API key, or project of your own required. Run it on your own firmware right after.
- **Zero-config first run.** Fresh installs land directly on a working home screen — no provider-selection gate before you can try the agent. The free tier is on by default; bring your own key anytime.
- **A home screen that guides the next step.** With a project open, the agent reads what it is and offers one-click **workflow cards** — *Build, flash & debug*, *Add a feature*, *Test & validate* — with *SDK migration* and *board bring-up* on the way. With no project open, it points you to *start a prototype* or *open your nRF project*. After any task finishes, it suggests where to go next instead of leaving a blank prompt.

### Notes

- The previous two-button home (*Analyze Logs* / *Generate Logging Code*) is replaced by the demo + context-aware workflow cards above; the same capabilities are reachable through *Build, flash & debug*.

### Reliability

- **Free-tier "tokens left" counter is now accurate.** It decrements by each request's real usage and shows **0** the moment the quota is exhausted — fixing the prior behavior where the chip could plateau (e.g. "~20k left") even after the free tier ran out. Resolves the 0.1.3 known issue.
- **Token counter shows on first launch.** The free-tier balance now appears immediately on a fresh install, instead of only after switching providers and back.
- **Invite codes.** Redeem a code in the free-tier panel (or the quota-exhausted card) for extra free-tier tokens.
- **Windows: better nRF tooling detection.** `nrfutil` is now found in more install locations (`NRFUTIL_HOME` and common Windows paths), fixing a spurious "nrfutil not found".
- **"What's new" re-appears on updates.** Patch releases (e.g. 0.1.3 → 0.1.5) now show the what's-new note to existing users, not only fresh installs.

## [0.1.3] - 2026-06-01

### Free tier — zero-friction onboarding

- **Run the agent without an API key.** New built-in free tier backed by a managed model hosted by Adsum Networks — no key, account, or card to evaluate the tool. Acted on the most-requested item from the previous release.
- **Instant BYOK switchover.** Adding your own key swaps the provider on the live task — no restart, the in-flight session continues.
- **Quota conversion card.** When the free quota runs out, a single-click prompt routes you to add a key and resumes the same task on your provider, instead of failing with a raw error.

### Reliability

- Quota exhaustion (HTTP 402) is handled cleanly — no spurious auto-retries or "Invalid API Response" noise.
- Rate-limit (429) responses surface a readable message instead of raw JSON.
- Free-tier usage telemetry corrected: funnel-entry fires once per install (was firing on every step), and the BYOK-conversion event now fires on the code path the settings form actually uses.

### Known issues

- Free-tier "tokens left" chip can briefly show a stale value until the next prompt; balance is backend-authoritative and harmless. See README → Limitations. *(Fixed in 0.1.5 — the chip now decrements live and shows 0 on exhaustion.)*

## [0.1.2] - 2026-05-31

### Fixed

- Toolbar and chat icons showed as blank squares, and the chat send button was missing on Linux. Icons now render correctly on macOS, Windows, and Linux.

### Changed

- Reduced the extension download size by ~6 MB.
- Improved Marketplace search keywords (nRF52/53/54, Zephyr, BLE, RTT, J-Link).

## [0.1.0] - 2026-05-26

The first release built around the **skill-first architecture**: domain expertise lives in versioned Markdown modules (workflows, actions, rules, board specs) that are loaded into the system prompt on demand based on what the agent detects in your workspace — not baked into a fixed prompt. Same model, smaller context, fewer wrong turns. Backed by an open hardware-in-the-loop benchmark.

### Architecture — `iot-knowledge/` skill library

- **New `iot-knowledge/` tree.** Every piece of nRF/Zephyr expertise the agent uses is now a Markdown file under `iot-knowledge/`, organized as `rules/`, `platforms/nrf/{rules,boards,sdks,workflows,actions}/`. Author once, ship as part of the extension, regenerate snapshots when changed. Adding a new SoC, protocol, or debug procedure is a Markdown PR — not a code change.
- **Workflows are entry points, Actions are subroutines.** Three primary workflows ship: `log-analyzer.md`, `log-generator.md`, `debug-loop.md`. Four atomic actions: `build.md`, `flash.md`, `capture-logs.md`, `analyze-logs.md`. The agent is hard-prohibited from loading an Action as the first read of a task — it must enter through a Workflow, which then pulls Actions via `MANDATORY SKILL LOAD` directives. This is enforced by `platforms/nrf/rules/skill-loading.md`.
- **Operation-Gating Principle.** Before performing any complex hardware operation (build / flash / capture / analyze / inject logs) the agent must `read_file` the matching Workflow first — regardless of how it arrived at that decision. Closes the failure mode where smaller models would skip the workflow load and improvise from pre-training.
- **Dynamic context loading.** `iot_context.ts` reads `prj.conf`, scans for `build_info.yml` in every build directory, and only injects the modules that match: BLE protocol guide when `CONFIG_BT=y`, the matching board file (nRF52832/52840/5340) for each detected build target, NCS SDK reference always. The system prompt fits what your project actually is.
- **Scope Gate + Context Budget Protection.** `AGENT.md` refuses non-NCS work in-extension (politely redirects), and `rules/core.md` Rule 9 forbids speculative reads outside the workspace and outside the NCS file pattern. No more agents wandering into `~/Documents` to "understand the workspace".
- **Device-Identity rule loaded by default.** `platforms/nrf/rules/device-identity.md` was listed mandatory in `PLATFORM.md` but never actually loaded in 0.0.x; now it is. Multi-device captures use generic `device1`/`device2` labels until role is confirmed by config or logs — no more guessing Central vs Peripheral from board type.
- **`platforms/nrf/PLATFORM.md`** rewritten as a proper directory index with full `triggerNordicAction` documentation, board-target → board-file map, and the skill library index.
- **Board Target Resolution Protocol** in `actions/build.md`: decision matrix that cross-references `build_info.yml` history with live `nrfutil device device-info --serial-number` output instead of guessing.

### Agent reliability — works across "any model"

- **Tool-call parsing hardened against four real-world failure modes**: DeepSeek DSML token stream (`<｜｜DSML｜｜...>`), Markdown code fences wrapping tool XML, literal template mimicry from small models (emitting `<tool_name>read_file</tool_name>` instead of substituting), and mid-task model switches that cross the native-tools ↔ XML-tools boundary. New `normalize-assistant-message.ts` stream-safe rewriter, +30 unit tests.
- **Model-family detection broadened**: DeepSeek V4-class included in native-tools allowlist; Anthropic `-latest` aliases recognized as Claude 4+; new `getToolCallReliabilityTier()` so the UI can warn once when a low-tier model fails to produce tool calls three turns in a row.
- **Windows process-cleanup fix.** The `taskkill /F /IM JLink.exe & taskkill /F /IM nrfutil.exe` form silently failed under PowerShell (`&` is reserved). Now emitted as `cmd /c "..."` from three sources — the action manuals and the tool's `TECHNICAL_REFERENCE` — so it works in PowerShell, bash, and `cmd.exe` identically.
- **Cross-platform J-Link binary resolution (RTT Plan B).** `connectRTTPlanB` previously hardcoded `/bin/bash` and `JLinkExe`. New `jlinkResolver.ts` walks deterministic SEGGER install paths, versioned `JLink_V*` dirs, and `PATH` — fails loudly with a useful error instead of silently launching a broken terminal. 33 unit tests cover Win32 / macOS Apple Silicon / Linux.
- **Read-file error guidance.** Missing `logs/<transport>/*.log` files now return a structured "run capture first" hint instead of raw `ENOENT`, and the analyze workflow is required to `list_files` on the logs directory before reading.

### Hardware-in-the-loop benchmark — IoT-FirmwareDebugBench v0.1

- **Published the first open benchmark for AI agents on embedded IoT firmware.** Six BLE-focused tasks across three difficulty levels, run on real nRF52840 DK and nRF52832 DK boards with NCS v3.2.1, same model on both sides (Claude Haiku 4.5). Full report under `docs/benchmarks/v0.1-report.md` with regenerable SVG figures and a stdlib-only `generate_figures.py` script.
- **Headline result:** Adsum IoT Coder resolved 5/6 tasks vs the general-agent baseline's 3/6, at 3.8× lower token cost. Architecture is the only variable.

### UI / UX

- **Welcome & home screen redesigned** with the new Adsum brand: coral logo, two prominent entry-point cards ("Debug Live Device Logs" promoted to first with brighter border), recent task cards on the home screen, brand orange (`#d76947`) on the focus-chain progress bar with green retained for success states.
- **Claude Code-style `ThinkingBlock`** replaces `ThinkingRow`: italic "Thought for Xs" label, animated dots while streaming, grid-rows collapse animation, auto-collapse when the response begins, expandable on demand. +21 unit tests covering label states, duration formatting, and expand/collapse.
- **Codicons + code font now load reliably in the installed extension.** Vite was emitting absolute `@font-face` URLs that 404'd silently under the webview's `vscode-resource://` scheme; fixed by setting `base: "./"` and dropping a redundant `<link>` to `node_modules/@vscode/codicons/`.
- **Mode icons rendered as base64 PNGs** (CSP-safe), with a theme-aware CSS filter (white in dark mode, black in light mode) via a new `useVSCodeTheme` hook that no longer misidentifies high-contrast light as dark.

### Telemetry — own project, real opt-out

- **Own PostHog project**, separate from upstream Cline. `ADSUM_TELEMETRY_SERVICE_API_KEY` injected at build time; `esbuild.mjs` auto-loads `.env` so `F5` and `npm run package` both work.
- **Opt-out setting** (`adsum-iot-coder.telemetry.enabled`) AND-combined with VS Code's global `telemetry.telemetryLevel` — either being off stops all collection.
- **Fork-attribution fields** on every event (`extension_name`, `extension_publisher`, `is_fork`, `upstream`, `arch`) so upstream-vs-fork usage is unambiguous in analytics.
- New `extension_installed` (once) and `extension_activated` (every session) lifecycle events for clean DAU/install tracking.
- User-facing privacy document: [TELEMETRY.md](./TELEMETRY.md).

### Rebrand

- Display name and UI now **Adsum IoT Coder – for nRF**; activity-bar icon, sidebar logo, welcome screen, social cards, hero GIF all updated. Marketplace identity (`AdsumNetwork.nrf-ai-debugger`) preserved to keep installs intact.
- All command, view, and config keys migrated to the `adsum-iot-coder.*` namespace.
- README rewritten around the AI-agent positioning, the skill-first architecture, and the v0.1 benchmark; supported SoCs broadened from "nRF52840" to **nRF52 / nRF53 / nRF54**.

### Other fixes

- macOS symlink resolution in `iot-knowledge` auto-approval allowlist.
- Onboarding reset button restored in About section; terminal icon fixed.
- Chat freeze on certain large reasoning streams resolved.
- DeepSeek reasoning content now passes through the OpenAI-compatible provider correctly.
- `build-proto.mjs` no longer breaks on macOS paths containing spaces.

## [0.0.4] - 2026-03-23

### Changed
- **Major Rebrand:** Extension renamed from "nRF AI Debugger" to **Adsum IoT Coder – for nRF**.
- **Repository Move:** All internal links and configuration updated to point to the new repository at [https://github.com/adsumnetworks/SoC-AI-Debugger](https://github.com/adsumnetworks/SoC-AI-Debugger).

### Added
- **PostHog Analytics:** Integrated PostHog to track anonymous usage data and Nordic toolchain errors, helping us identify missing dependencies or environmental issues automatically.
- **Compliance:** Added official trademark disclaimer for nRF and Nordic Semiconductor compliance.

### Fixed
- **Log Analyzer Reliability:** Significant improvements to cross-platform UART and RTT log capture stability.
- **Terminal Routing:** Fixed a bug where named terminals (nRF Connect) were incorrectly routed to hidden `cmd.exe` processes in background execution mode.

## [0.0.2] - 2026-03-02

### Fixed
- **Terminal Warning Suppression:** Removed the annoying "Shell Integration Unavailable" warning for nRF Connect terminals.
- **Background Execution:** Fixed a critical bug where named terminals (e.g., nRF Connect) were routed to hidden `cmd.exe` processes instead of the proper PowerShell terminal when the terminal execution mode was set to "Background Exec". This ensures `nrfutil` and `west` commands work reliably.
- **Terminal Timeout:** Increased the shell integration timeout to ensure slower PCs (e.g., Windows 10) have enough time to initialize the nRF Connect SDK environment before executing commands.

## [0.0.1] - Initial Release

### Added
- Initial release of Adsum IoT Coder!
- Seamless integration with the nRF Connect SDK terminal in VS Code.
- AI-powered assistant for Zephyr-based projects capable of automatically analyzing UAR/RTT logs, executing Nordic toolchain commands, and debugging code.