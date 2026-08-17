# Changelog

All notable changes to the **Adsum IoT Coder** extension will be documented in this file.

## [0.2.1] - 2026-08-17

### Added
- Project memory: an `.adsum/` folder per project holding the board, transport, goal, open defects, and researched notes, written when something is learned and read at the start of every task. Multi-app repositories get one memory per app plus a shared one above them.
- Log search: captured RTT, UART, HCI, and sniffer logs are searched by pattern and read by line range instead of loaded whole. A real capture that cost 333,000 tokens now costs a few thousand. A search with no matches falls back to the log's structure and the firmware's own vocabulary, or asks, instead of reading thousands of lines.
- nRF54 board knowledge: the nRF54L15 DK, the nRF54LM20 DK, and the nRF54LM20A, plus a migration guide from nRF52840 to nRF54L.
- The board is identified from connected hardware and the project's own board settings before the first build, instead of guessed from build output that does not exist yet.
- Board knowledge can state the nRF Connect SDK version it needs; you are warned when yours is older, at the point the knowledge is used.
- DeepSeek as a native provider: correct context length, pricing, and cache rates. Extended thinking can be turned off for routine steps, or set to Low, High, or Max.
- Export a session as a single redacted file, and hand a running task to your own coding agent (beta).

### Fixed
- Three context-window accounting bugs: cached tokens were counted twice; the window ignored the space a model reserves for its reply, which caused `Prompt exceeds max length`; and an oversized-request refusal went unrecognised, so the existing recovery never ran.
- Compaction is announced before it happens, reports what it kept, and preserves the goal, the board, the bug being chased, and the file in hand.
- Tool results are bounded: file edits return a diff with surrounding lines instead of echoing the file, and long command output is folded with every error and warning kept.
- Typing while the agent works no longer loses your draft when an approval request arrives.
- Espressif boards are no longer re-probed in the terminal when the chip, revision, and port are already detected.
- Checkpoint messages say what is happening: a slow first snapshot on a large repo reads as work in progress, says so once, and takes itself down; nothing is shown where checkpoints simply do not apply.
- A prototype run ends on an "Open project folder" button instead of a paragraph of instructions; the conversation is saved and returns from History after the reload.
- GLM 4.7 and 5.x are recognised, so they are no longer scored as unreliable models.

### Known issues
- Opening a scaffolded project is still a manual step; until the folder is open, the new project has no memory or checkpoints.
- nRF54L support is still maturing. Building and flashing works, with rough edges around board-root setup and runner selection. nRF52 and nRF53 paths are unaffected.

## [0.2.0] - 2026-07-21

A full end-to-end gateway build, your model or your key, credited expertise, and a second marketplace.

### Build a whole product, not just a fix

Expanded curated firmware knowledge now carries a full, long-horizon build across two chips and two toolchains. The launch build is a complete two-chip BLE-to-WiFi gateway, an nRF52840 BLE scanner on Zephyr and an ESP32 Wi-Fi and MQTT uplink on ESP-IDF, for the Fanstel board, from one spec in one working session with the developer approving each step. See the [walkthrough](https://docs.adsumnetworks.com/ble-wifi-gateway).

### Choose your model

A curated model picker: the free tier, the GLM Coding Plan (glm-5.2 with 1M context, plus glm-5-turbo and glm-4.7), Claude (Sonnet 5, now the default, Opus 4.8, Haiku 4.5), DeepSeek V4 (flash and pro), and any OpenAI or Anthropic-compatible endpoint, cloud or local. Switch on a live task with no restart.

### Credited expertise

When the agent uses a piece of curated knowledge, it names the engineer who wrote it, in the conversation and linked, with a provenance popover (author, maintainer, version, license, source). Human-curated, never anonymous AI output.

### A next step, everywhere

The forward-handoff behavior CRA runs got in 0.1.8 now applies to every workflow: a finished task offers concrete next actions instead of a dead-end "done".

### Longer sessions hold up

Token-aware context handling replaces blunt transcript truncation, so a long session (the gateway build above, a big BLE capture, a full CRA sweep) is less likely to lose the data it needs mid-session.

### Now on Open VSX

Adsum is published to [Open VSX](https://open-vsx.org/extension/AdsumNetwork/nrf-ai-debugger) as well as the VS Code Marketplace, so Cursor, Windsurf, VSCodium, and other VS Code-compatible editors can install it.

### Reliability

- ESP-IDF version parsing fixed for more install layouts.
- The Stop button now interrupts a hanging terminal command.
- The CRA nudge no longer fires on Adsum's own repository.

### Preview

- Hand a running task to your own coding agent (beta): Adsum supplies the embedded knowledge and drives the toolchain while your agent does the work. Rolling out gradually.

## [0.1.8] - 2026-07-07

3-layer debug lands (app, HCI, and radio), alongside a hardening pass for the CRA Readiness Check driven by real field runs on Windows and macOS.

### 3-layer debug

Adsum now debugs across all three layers of a BLE connection: the application log, the HCI host↔controller bus, and the over-the-air radio, correlated to show where a flow actually broke. It builds on the HCI decoding shipped in 0.1.7 (parsing Host Controller Interface event streams into human-readable BLE protocol events). The guided **HCI + Sniffer sample run** promised in 0.1.7 is now the on-ramp: a walkthrough of a real one-directional BLE bug that lands on the one-line fix and bridges into the CRA readiness check. It runs on a bundled sample with no hardware needed, and the same debugging works on your own nRF boards.

### CRA runs don't dead-end anymore

- **A CRA run now rests on an open question, never a "task complete" box.** No more dead-end endings or "I'll continue later" traps, the run always offers concrete forward actions (triage this CVE, start closing this gap), and you leave simply by moving on. The old completion scorecards (with pass/fail glyphs) are blocked at the source.
- **Knowledge-loading is self-healing.** A transient network blip on a knowledge fetch now retries silently; a mistyped knowledge path auto-corrects when the catalog has exactly one match (a real run dead-ended on `cra/rules/core.md` vs `cra/core.md`, that class of failure is gone). Error messages now say precisely what failed: transient fetch vs not-in-catalog vs registry unreachable.
- **The readiness-report integrity guard is fairer and clearer.** It no longer misreads honest phrasing like "62 total packages: 10 queryable" as a wrong count (a correct report was rejected 3× for this), and every rejection now quotes the exact line it objected to, so a rewrite lands in one attempt.

### Honesty & safety hardening (from real run reviews)

- **Never weakens your project to make a scan work.** New hard rules: the agent must never disable your security features (secure boot, flash encryption, signed OTA) to force a build, must never edit your SDK/toolchain installation (a run had patched a script inside `C:\ncs\`, now banned), and if an earlier scan run left your config modified, the posture check detects it and offers a restore instead of counting those as *your* gaps.
- **ESP SBOM generation fixed for IDF 5.x.** The documented `--output-file` flag is used, and `idf.py sbom-create --spdx-file` (absent on IDF 5.5.4) is version-checked before use instead of failing.
- **Silent commands aren't "failures" anymore.** Commands that legitimately produce no output (`mkdir`, `cp`, …) no longer report a scary "technical issue", the agent is told plainly: silent success, verify state directly if it matters.

### Windows reliability

- **The terminal just works on a fresh Windows install.** New Windows machines ship PowerShell locked down (Restricted execution policy), which silently blocks VS Code's shell integration so the agent can't read command output. The extension now detects and repairs this in the background at startup, sets the execution policy to RemoteSigned (current-user scope), selects a working default terminal profile, and restarts stale terminals, with a dismissible note of what changed. Group Policy-managed machines are left untouched.

### Compact input area

- The input stack is dramatically slimmer: one-line input that grows as you type, auto-approve as a compact ⚡ chip next to **@**, and the wide Cancel/Resume buttons replaced by a Claude-style **send ↔ stop** morphing icon (brand cyan, instant tooltips). The chat input glows cyan on focus.
- The "What's new" card icon is now theme-consistent (no more OS-style emoji).

## [0.1.7] - 2026-06-24

### CRA Readiness Check: get CRA-ready as you build

A new one-click **CRA Readiness Check** helps you prepare for the EU Cyber Resilience Act, on **both nRF and ESP**. It's a readiness snapshot to help you prepare, not a conformity assessment, and not legal advice.

- **SBOM from your real build.** A machine-readable software bill of materials (SPDX), the CRA's named artifact, generated from the actual build, not a guess.
- **Secure-by-design posture.** A checklist against your build's real configuration (secure boot, signed updates, debug-port lock, secure pairing, secure storage, and more), each item evidence-grounded (the literal config fact, not a generic assertion), ordered so prerequisites come first.
- **Advisories for your SDK version.** Surfaced with links to review, never an automatic verdict.
- **Help you start.** The agent offers to begin closing the top gap (e.g. add a secure bootloader), routing into the normal add-feature flow.
- Writes a `compliance/` folder: a human-readable report, a machine-readable JSON companion, and the SBOM. Run it on your project, or try it on a bundled sample with nothing open.

It also tells you which CRA date applies to you up front, whether you're getting a head start on the Dec 2027 essential requirements, or already in scope for the Sep 2026 reporting duty.

### HCI deep-debug: three layers for BLE projects

When a BLE project is open (`CONFIG_BT=y` detected), the welcome screen now surfaces a one-line shortcut to the full debug stack:

> **app logs · HCI · radio sniffer** *(soon)*

The HCI layer is new: the extension can now parse Host Controller Interface (HCI) event streams and decode them to human-readable BLE protocol events, helping you see exactly what's happening at the controller level, not just the application log.

A guided **HCI + Sniffer sample run**, a three-layer walkthrough (app log → HCI bus → over-the-air) that lands on the one-line fix and bridges to the CRA readiness check, is coming in a follow-up release.

### nRF terminal: self-contained, version-aware

The nRF terminal now detects which NCS version your build uses and executes commands against that SDK automatically, no manual path wrangling. When you have multiple NCS installs (e.g. v3.2.1 and v3.3.1), the agent follows the build directory's version, not whichever was compiled most recently.

### ESP reliability

- **Multi-board builds.** When multiple ESP-IDF versions are installed, the extension now shows all of them, not just the first, removing the "ambiguous forever" state where a project pinned to a different version than the global install.
- **Version detection on git-clone installs.** ESP-IDF git checkouts have no `version.txt`; the extension now reads `tools/cmake/version.cmake` as a reliable fallback, so the platform strip always shows the correct IDF version regardless of install method.

### Welcome screen: adaptive, not static

- **"Try it on a sample" picker.** A new inline picker lists available demos (BLE bug, CRA readiness check, and more). Appears when no project is open; becomes a re-run link once you've tried one.
- **CRA nudge for BLE projects.** When a BLE project is open but has no `compliance/` folder yet, a dismissible note surfaces: "A connected product likely falls under the EU CRA, preview your secure-by-design posture." Evidence-grounded, never a verdict.
- **Compact platform status.** The nRF/ESP detection panel collapses to a one-line summary per detected platform (e.g. `nRF · NCS 3.2.1 · nRF5340 DK`). Click to expand for full detail.

### Diagrams that match your theme

Mermaid diagrams in chat now follow your VS Code light/dark theme and the Adsum palette, previously they used a fixed dark theme that was hard to read in light mode.

### Honesty hardening

The agent's CRA output is now verified against a 108-fixture scanner before it leaves the model. New rules added this release: the agent can no longer produce numeric readiness scores, "non-compliant" verdicts, or citations to CRA articles that don't exist. All posture items are evidence-mode only, literal config facts, with "verify" always the next step.

### Legal

- `NOTICE` file added (Apache 2.0 §4c attribution).
- `iot-knowledge/LICENSE` makes the open k-bits' license explicit.
- README updated: open-core model, AI limitations, trademark notices.

## [0.1.6] - 2026-06-16

### One extension: now for ESP32, too

Adsum IoT Coder now speaks **Espressif ESP32 / ESP-IDF** as well as Nordic nRF, in a single install. It reads what's on your desk and in your workspace and shows the right tools, workflows, and guidance for each platform, nothing to switch.

- **ESP32 / ESP-IDF support.** Build, flash, monitor, and test ESP-IDF firmware with the same guided agent workflows you already use for nRF, `idf.py`/`esptool`-driven, with chip, flash, and PSRAM detection and serial-log capture built in.
- **Automatic platform detection.** The home screen recognizes whether your workspace is nRF, ESP, both, or a fresh start, and routes every workflow card and the agent's expertise to the right platform automatically.
- **Prototyping for both platforms.** *Start a prototype* now scaffolds complete ESP-IDF projects too, it sets the target chip, lays out the project, and gets you to a first build, the same way it already does for nRF.
- **Always-current knowledge, leaner install.** Platform expertise is delivered on demand and cached locally, so the extension stays small and the guidance stays up to date without waiting for a new release.

### Reliability & cross-platform

- **Stronger Windows support.** Board and toolchain detection now handle the full range of real-world install layouts on Windows, nRF boards and NCS versions surface correctly, ESP-IDF is found wherever it's installed, and serial-log capture runs cleanly. Verified on real nRF and ESP hardware.
- **Smarter ESP toolchain selection.** When more than one ESP-IDF version is installed, the agent uses the one your project pins, and asks you when it's genuinely ambiguous instead of guessing.
- **Steadier file editing.** Edits now apply cleanly even on large, streamed changes.
- **Cleaner diagrams.** Architecture and sequence diagrams render reliably across models.

### Notes

- Existing nRF projects are unaffected, same workflows, same behavior.

## [0.1.5] - 2026-06-08

### A full UI redesign: rebuilt around how you start

Early users told us the hardest part wasn't the agent, it was the cold start. So we rebuilt the entire first-run experience: see it work *before* any setup, land on something useful immediately, and always have a clear next step.

- **See it debug a real bug, in 30 seconds, before you set anything up.** A new first-run demo debugs a real BLE bug on firmware bundled with the extension, capture → analyze → fix on a genuine failure, with no board, API key, or project of your own required. Run it on your own firmware right after.
- **Zero-config first run.** Fresh installs land directly on a working home screen, no provider-selection gate before you can try the agent. The free tier is on by default; bring your own key anytime.
- **A home screen that guides the next step.** With a project open, the agent reads what it is and offers one-click **workflow cards**, *Build, flash & debug*, *Add a feature*, *Test & validate*, with *SDK migration* and *board bring-up* on the way. With no project open, it points you to *start a prototype* or *open your nRF project*. After any task finishes, it suggests where to go next instead of leaving a blank prompt.

### Notes

- The previous two-button home (*Analyze Logs* / *Generate Logging Code*) is replaced by the demo + context-aware workflow cards above; the same capabilities are reachable through *Build, flash & debug*.

### Reliability

- **Free-tier "tokens left" counter is now accurate.** It decrements by each request's real usage and shows **0** the moment the quota is exhausted, fixing the prior behavior where the chip could plateau (e.g. "~20k left") even after the free tier ran out. Resolves the 0.1.3 known issue.
- **Token counter shows on first launch.** The free-tier balance now appears immediately on a fresh install, instead of only after switching providers and back.
- **Invite codes.** Redeem a code in the free-tier panel (or the quota-exhausted card) for extra free-tier tokens.
- **Windows: better nRF tooling detection.** `nrfutil` is now found in more install locations (`NRFUTIL_HOME` and common Windows paths), fixing a spurious "nrfutil not found".
- **"What's new" re-appears on updates.** Patch releases (e.g. 0.1.3 → 0.1.5) now show the what's-new note to existing users, not only fresh installs.

### Smarter workflows behind the cards

The one-click workflow cards now hold up across platforms and harder projects:

- **Test & validate works on Windows and macOS, not just Linux.** It picks the right path for your machine: a host simulator where one fits, or running the **same tests on your connected board** with no extra install. It's also honest about what a simulator can and can't prove (logic vs. real radio, sensor, and timing), and walks you through the one-time QEMU setup only when you actually need board-free runs.
- **Prototyping handles two-device and sensor builds.** Ask for a central ↔ peripheral system and it scaffolds **both** apps from the matching Nordic samples and flashes each to its own board; ask for an I²C sensor and it wires the devicetree overlay correctly, the parts that usually trip people up. It builds the files for you instead of pointing you at a sample to open, and sketches the architecture (and a two-device timeline) first.
- **Debug a board that's already running, no reflash.** *Build, flash & debug* can now skip straight to capturing and analyzing logs when your device is already running the firmware you want to inspect.

## [0.1.3] - 2026-06-01

### Free tier: zero-friction onboarding

- **Run the agent without an API key.** New built-in free tier backed by a managed model hosted by Adsum Networks, no key, account, or card to evaluate the tool. Acted on the most-requested item from the previous release.
- **Instant BYOK switchover.** Adding your own key swaps the provider on the live task, no restart, the in-flight session continues.
- **Quota conversion card.** When the free quota runs out, a single-click prompt routes you to add a key and resumes the same task on your provider, instead of failing with a raw error.

### Reliability

- Quota exhaustion (HTTP 402) is handled cleanly, no spurious auto-retries or "Invalid API Response" noise.
- Rate-limit (429) responses surface a readable message instead of raw JSON.
- Free-tier usage telemetry corrected: funnel-entry fires once per install (was firing on every step), and the BYOK-conversion event now fires on the code path the settings form actually uses.

### Known issues

- Free-tier "tokens left" chip can briefly show a stale value until the next prompt; balance is backend-authoritative and harmless. See README → Limitations. *(Fixed in 0.1.5, the chip now decrements live and shows 0 on exhaustion.)*

## [0.1.2] - 2026-05-31

### Fixed

- Toolbar and chat icons showed as blank squares, and the chat send button was missing on Linux. Icons now render correctly on macOS, Windows, and Linux.

### Changed

- Reduced the extension download size by ~6 MB.
- Improved Marketplace search keywords (nRF52/53/54, Zephyr, BLE, RTT, J-Link).

## [0.1.0] - 2026-05-26

The first release built around the **skill-first architecture**: domain expertise lives in versioned Markdown modules (workflows, actions, rules, board specs) that are loaded into the system prompt on demand based on what the agent detects in your workspace, not baked into a fixed prompt. Same model, smaller context, fewer wrong turns. Backed by an open hardware-in-the-loop benchmark.

- **Knowledge loads on demand.** The agent reads your project (`prj.conf`, build targets) and pulls only the modules that match: the BLE guide for a BLE build, the right board file, the SDK reference. Adding a new SoC, protocol, or debug procedure is a knowledge change, not a code change.
- **Enters through a workflow, never improvises.** Before any build, flash, capture, or analyze, the agent loads the matching workflow first, closing the failure mode where smaller models skip it and guess from pre-training.
- **Works across models.** Tool-call handling hardened for Claude, DeepSeek, and small local models, including mid-task model switches.
- **Reliable on Windows.** Process cleanup, J-Link resolution, and RTT log capture fixed across PowerShell, cmd, and bash.
- **Open benchmark, IoT-FirmwareDebugBench v0.1.** Six BLE tasks on real nRF52 hardware: 5/6 vs a general agent's 3/6 at 3.8x fewer tokens, same model on both sides.
- **New Adsum brand and redesigned welcome/home screen.** Supported SoCs broadened to nRF52 / nRF53 / nRF54. Pseudonymous product analytics keyed to a random install id; opt out anytime.

## [0.0.4] - 2026-03-23

### Changed
- **Major Rebrand:** Extension renamed from "nRF AI Debugger" to **Adsum IoT Coder – for nRF**.
- **Repository Move:** All internal links and configuration updated to point to the new repository at [https://github.com/adsumnetworks/SoC-AI-Debugger](https://github.com/adsumnetworks/SoC-AI-Debugger).

### Added
- **Trademark disclaimer** added for nRF and Nordic Semiconductor compliance.
- Pseudonymous usage analytics to help catch missing dependencies and toolchain errors automatically; opt out anytime.

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