# Changelog

All notable changes to the **Adsum IoT Coder** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- A folder that was empty when the extension activated is classified again once files land in it, so a
  guided build that seeds a gateway under the agent's own hand gets its platform knowledge and product
  route on the next task instead of after a reload; the universal product route now says to load the
  product index first, including on the build's own "Continue … Step N/7" opener.

### Added
- A redesigned entry surface. The panel opens on where you are and what is on your desk — folder,
  detected boards, toolchains — then the runs worth starting, ranked by what was actually detected,
  each saying why. Typing in the box *is* the new session; there is no separate button. One named
  resume is always offered when there is a past session for the folder you are in.
- A sessions menu (☰) that is the single home for past sessions: filter, rename, delete, and
  "see all". Reachable from the entry surface and from inside a running session.
- Guided builds for partner hardware are offered from a cold start, alongside three sample runs that
  need no hardware and nothing installed.
- Your own model prices. `adsum-iot-coder.modelPricing` in settings takes a price per model in USD
  per million tokens and overrides everything else — for a negotiated rate, a regional price list, or
  a vendor change we have not published yet.
- Model prices can now update without an extension release, the way advisory data already does.
- Send a message to a session that is already working. It is queued, shown at the end of the
  conversation with a way to take it back, and delivered at the agent's next step — so a run can be
  steered without cancelling it. Stop is still its own button, and returns anything undelivered to the
  chat box.

### Changed
- Knowledge is loaded, not "skilled". The agent's own vocabulary now says **bit** everywhere it used
  to say skill — the instruction it follows is `MANDATORY BIT LOAD`, and the rule that governs it is
  `rules/bit-loading.md`. Your editor's own Skills feature is untouched; the two were colliding in one
  place, which is how an agent reaches for the wrong one.
- Guided builds load the measurement doctrine instead of a summary of it. A paraphrase in the workflow
  was being read as the rule itself, so gates could report a count where they owed you evidence.
- The About page names what Adsum runs on today — Nordic nRF52/53/54L and nRF91 with NB-IoT, LTE-M
  and GNSS, Espressif ESP32/S3/C6, and the supported partner gateways — rather than a shorter list
  that had fallen behind.
- "Bring your own coding agent" is marked *Coming soon* and cannot be selected while it is unproven.

### Fixed
- **DeepSeek and GLM ignored the thinking depth you chose.** Picking *Low* stored and displayed the
  choice, but neither the thinking setting nor the depth reached the request, so the provider applied
  its own default — full-depth thinking — on every call. Long, expensive thinking on routine steps.
  A depth chosen now counts as thinking on, and a configuration made before this fix starts working
  without being touched.
- **The OpenAI reasoning-effort setting did nothing.** It was read, stored and even counted, but the
  request never carried it.
- **DeepSeek costs were understated roughly four to five times.** The built-in prices for V4 had
  drifted far below the published ones. They have been re-read from the vendor and corrected, and
  DeepSeek's off-peak half-price window — which covers most of the week — is now applied from the
  clock instead of being ignored.
- The composer could be left permanently disabled, with no way to send, after a task finished.
- Text the agent had already finished saying could be re-rendered when a tool call followed it, and a
  stalled reply that the host had already retried was left on screen as a stray fragment.
- A message typed while the agent was working could be taken as the answer to a tool approval that had
  not been shown yet. The path that did this is gone; nothing typed mid-run can approve a tool.
- A guided build's step banner was hard-coded to five steps, so a seven-beat product build rendered
  "Step 4/7" as a plain heading instead of a banner.
- A workspace whose applications sit in subfolders — a gateway with its ESP app in `esp32/` and its
  Zephyr apps beside it — loaded no platform knowledge and no product knowledge at all. The heavy
  blocks probed only the workspace root for `sdkconfig` / `prj.conf`, while the classifier had already
  scanned deeper and correctly called it a mixed workspace; the two disagreed, and with no board
  plugged in nothing rescued it. Each platform's knowledge is now built from the application folder
  the classifier found.

## [0.3.1] - 2026-08-26

*0.2.2 and 0.3.0 were never published; their work ships here.*

### Added
- nRF91 cellular: NB-IoT, LTE-M, NTN and DECT NR+, each loaded only for the project that needs it.
- GNSS positioning knowledge for nRF91.
- Board knowledge for the nRF9161 DK, nRF9151 DK and nRF9160 DK.
- Board shell: send AT and Zephyr shell commands and read until the board finishes, on all platforms.
- Modem trace: capture, decode and explain registration state, refusal reason, radio mode and search events.
- `log-shape`: describe a log's structure in one call, then read any message kind in context.
- Knowledge is named when it loads, not only when the agent reads a file.
- Every device tool is a Tool bit: versioned, credited, and hash-verified before it runs.
- CRA advisory hints and package mappings update from the registry instead of a release.
- Crash-address decoder that picks `addr2line` by chip architecture and reports where it looked.
- Board and chip names come from knowledge, including a catalogue of ten shipping ESP32 targets.
- Fanstel LEW840X boards route to their own product knowledge.

### Changed
- A newer registry copy of a bit or tool wins over the bundled one; bundled remains the fallback.
- An update cannot widen what a tool may do on its own; the stricter rule stands.
- Credit reports the copy that actually served, not always the bundled one.
- About names both platforms and the CRA check, and links the docs rather than a chip vendor.
- Building the extension no longer depends on the build machine's Node version.

### Fixed
- A tool that could not run no longer reports as though it had.
- Device tools no longer try to install Python packages; the wrappers no longer hide the install location.
- An empty answer from a device is no longer reported as a finding.
- The "Open project folder" button did nothing, could point at the wrong project, and never appeared for copied samples.
- A scaffolded project you never opened stopped following you into unrelated tasks.
- Refusing to write project memory now says plainly that it is a blocker.
- Log and code search: the search program was not found, so nearly every search returned no results.
- Mermaid diagrams render more reliably.
- A CVE scan that could not run no longer reads as a clean one.
- Large captures no longer return truncated with a success status.
- A tool improved in the registry could still be read back from an older copy on disk.
- Third-party code bundled into a tool is now named in its notice file.
- Two links pointed at a repository that had been renamed.
- A multi-chip product had nowhere to keep its project memory.
- The ESP monitor put the chip into the bootloader when opening the port.
- A silent ESP capture now retries the reset once, and a retry never leaves less evidence than the first attempt.
- ESP commands source the toolchain environment in the terminal that actually runs them.
- `idf.py is not recognized` is reported as a broken virtual environment, not a missing source step.
- Native modules now load on Windows.

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

## [0.2.0] - 2026-07-21

A full end-to-end gateway build, your model or your key, credited expertise, and a second marketplace.

### Added

- **Long-horizon builds.** Curated knowledge now carries a complete two-chip gateway from one spec: an nRF52840 BLE scanner on Zephyr and an ESP32 Wi-Fi and MQTT uplink on ESP-IDF, on a Fanstel board, with the developer approving each step. See the [walkthrough](https://docs.adsumnetworks.com/ble-wifi-gateway).
- **A curated model picker.** The free tier, the GLM Coding Plan (glm-5.2 with 1M context, glm-5-turbo, glm-4.7), Claude (Sonnet 5, now the default, Opus 4.8, Haiku 4.5), DeepSeek V4 (flash and pro), and any OpenAI- or Anthropic-compatible endpoint, cloud or local. Switchable on a live task with no restart.
- **Credited expertise.** When the agent uses a piece of curated knowledge it names the engineer who wrote it, linked, with a provenance popover: author, maintainer, version, licence, source.
- **A next step, everywhere.** The forward handoff CRA runs got in 0.1.8 now applies to every workflow: a finished task offers concrete next actions instead of a dead-end "done".
- **Token-aware context handling.** Replaces blunt transcript truncation, so a long session is less likely to lose the data it needs mid-run.
- **Published to [Open VSX](https://open-vsx.org/extension/AdsumNetwork/nrf-ai-debugger).** Installable in Cursor, Windsurf, VSCodium and other VS Code-compatible editors.
- **Agent handover (beta).** Hand a running task to your own coding agent, with Adsum supplying the embedded knowledge and driving the toolchain. Rolling out gradually.

### Fixed

- ESP-IDF version parsing fixed for more install layouts.
- The Stop button now interrupts a hanging terminal command.
- The CRA nudge no longer fires on Adsum's own repository.

## [0.1.8] - 2026-07-07

3-layer debug lands (app, HCI, and radio), alongside a hardening pass for the CRA Readiness Check driven by real field runs on Windows and macOS.

### Added

- **3-layer BLE debug.** The application log, the HCI host-controller bus, and the over-the-air radio, correlated to show where a flow actually broke. Builds on the HCI decoding shipped in 0.1.7.
- **The guided HCI + Sniffer sample run**, promised in 0.1.7, is the on-ramp: a real one-directional BLE bug walked to its one-line fix, then bridged into the CRA readiness check. Runs on a bundled sample with no hardware.
- **A much slimmer input stack.** One-line input that grows as you type, auto-approve as a compact chip beside **@**, and the wide Cancel/Resume buttons replaced by a morphing send-stop icon.
- The "What's new" card icon is now theme-consistent, with no OS-style emoji.

### Fixed

- **A CRA run rests on an open question, never a "task complete" box.** No dead-end endings and no "I'll continue later" traps: the run always offers concrete forward actions, and you leave by moving on. The old pass/fail completion scorecards are blocked at the source.
- **Knowledge loading is self-healing.** A transient fetch blip retries silently, and a mistyped knowledge path auto-corrects when the catalog has exactly one match (a real run dead-ended on `cra/rules/core.md` against `cra/core.md`). Errors now name the cause: transient fetch, not in catalog, or registry unreachable.
- **The readiness-report integrity guard is fairer.** It no longer misreads honest phrasing such as "62 total packages: 10 queryable" as a wrong count, and every rejection quotes the line it objected to, so a rewrite lands first time.
- **The agent never weakens your project to make a scan work.** It may not disable secure boot, flash encryption or signed OTA to force a build, and may not edit your SDK installation (a run had patched a script inside `C:\ncs\`; now banned). If an earlier run left your config modified, the posture check offers a restore instead of counting those as your gaps.
- **ESP SBOM generation fixed for IDF 5.x.** The documented `--output-file` flag is used, and `idf.py sbom-create --spdx-file`, absent on IDF 5.5.4, is version-checked before use rather than failing.
- **Silent commands are no longer reported as failures.** Commands that legitimately produce no output (`mkdir`, `cp`) no longer raise a "technical issue": the agent is told plainly that this is silent success.
- **The terminal works on a fresh Windows install.** New machines ship PowerShell Restricted, which silently blocks shell integration so the agent cannot read command output. This is now detected and repaired at startup, with a dismissible note of what changed. Group Policy-managed machines are left untouched.

## [0.1.7] - 2026-06-24

The one-click CRA Readiness Check arrives, on both nRF and ESP, alongside HCI decoding and a version-aware nRF terminal.

### Added

- **A one-click CRA Readiness Check**, on both nRF and ESP. A readiness snapshot to help you prepare: not a conformity assessment, and not legal advice. It tells you up front which CRA date applies to you, the Dec 2027 essential requirements or the Sep 2026 reporting duty.
- **An SBOM from your real build.** A machine-readable SPDX bill of materials, the CRA's named artifact, generated from the actual build rather than guessed.
- **A secure-by-design posture check.** Measured against your build's real configuration (secure boot, signed updates, debug-port lock, secure pairing, secure storage), each item evidence-grounded in the literal config fact and ordered so prerequisites come first.
- **Advisories for your SDK version**, surfaced with links to review, never as an automatic verdict.
- **An offer to start closing the top gap**, routing into the normal add-feature flow.
- **A `compliance/` folder** holding a human-readable report, a JSON companion, and the SBOM. Run it on your project or on a bundled sample with nothing open.
- **HCI decoding.** Host Controller Interface event streams are parsed into human-readable BLE protocol events, so you can see what happens at the controller level, not just in the application log. When a BLE project is open (`CONFIG_BT=y` detected), the welcome screen surfaces the full debug stack: app logs, HCI, radio sniffer.
- **A version-aware nRF terminal.** It detects which NCS version your build uses and runs commands against that SDK. With several installs it follows the build directory's version, not whichever was compiled most recently.
- **A "try it on a sample" picker**, listing the available demos when no project is open, and becoming a re-run link once you have tried one.
- **A CRA nudge for BLE projects** with no `compliance/` folder yet. Dismissible, evidence-grounded, never a verdict.
- **A compact platform status strip.** The nRF/ESP detection panel collapses to one line per platform (`nRF · NCS 3.2.1 · nRF5340 DK`), expandable for detail.

### Changed

- Mermaid diagrams in chat now follow your VS Code theme and the Adsum palette, instead of a fixed dark theme that was hard to read in light mode.
- `NOTICE` file added, for Apache 2.0 section 4(c) attribution.
- `iot-knowledge/LICENSE` makes the open bits' licence explicit.
- README updated for the open-core model, AI limitations and trademark notices.

### Fixed

- **CRA output is verified against a 108-fixture scanner before it leaves the model.** The agent can no longer produce numeric readiness scores, "non-compliant" verdicts, or citations to CRA articles that do not exist. Posture items are evidence-mode only, with "verify" always the next step.
- **Multi-board builds.** With several ESP-IDF versions installed, all of them are shown rather than only the first, removing the state where a project pinned to a different version than the global install stayed ambiguous.
- **Version detection on git-clone installs.** ESP-IDF checkouts have no `version.txt`, so `tools/cmake/version.cmake` is read as a fallback and the platform strip shows the right version regardless of install method.

## [0.1.6] - 2026-06-16

Adsum IoT Coder now speaks **Espressif ESP32 / ESP-IDF** as well as Nordic nRF, in a single install. It reads what's on your desk and in your workspace and shows the right tools, workflows, and guidance for each platform, nothing to switch.

### Added

- **ESP32 / ESP-IDF support.** Build, flash, monitor, and test ESP-IDF firmware with the same guided agent workflows you already use for nRF, `idf.py`/`esptool`-driven, with chip, flash, and PSRAM detection and serial-log capture built in.
- **Automatic platform detection.** The home screen recognizes whether your workspace is nRF, ESP, both, or a fresh start, and routes every workflow card and the agent's expertise to the right platform automatically.
- **Prototyping for both platforms.** *Start a prototype* now scaffolds complete ESP-IDF projects too, it sets the target chip, lays out the project, and gets you to a first build, the same way it already does for nRF.
- **Always-current knowledge, leaner install.** Platform expertise is delivered on demand and cached locally, so the extension stays small and the guidance stays up to date without waiting for a new release.

### Fixed

- **Stronger Windows support.** Board and toolchain detection now handle the full range of real-world install layouts on Windows, nRF boards and NCS versions surface correctly, ESP-IDF is found wherever it's installed, and serial-log capture runs cleanly. Verified on real nRF and ESP hardware.
- **Smarter ESP toolchain selection.** When more than one ESP-IDF version is installed, the agent uses the one your project pins, and asks you when it's genuinely ambiguous instead of guessing.
- **Steadier file editing.** Edits now apply cleanly even on large, streamed changes.
- **Cleaner diagrams.** Architecture and sequence diagrams render reliably across models.

## [0.1.5] - 2026-06-08

A full first-run redesign, built around the cold start rather than the agent.

### Added

- **See it debug a real bug in 30 seconds, before you set anything up.** A first-run demo runs capture, analyse and fix on a genuine BLE failure in bundled firmware, with no board, key or project of your own.
- **Zero-config first run.** Fresh installs land on a working home screen with no provider-selection gate. The free tier is on by default.
- **A home screen that offers the next step.** With a project open it reads what the project is and offers one-click workflow cards: *Build, flash & debug*, *Add a feature*, *Test & validate*. With none open it points to starting a prototype or opening an existing project.
- **Test & validate works on Windows and macOS**, not only Linux. It picks a host simulator where one fits or runs the same tests on your connected board with no extra install, is honest about what a simulator cannot prove (real radio, sensor and timing), and walks you through the one-time QEMU setup only when you actually need board-free runs.
- **Prototyping handles two-device and sensor builds.** A central-peripheral system scaffolds both apps from the matching Nordic samples and flashes each to its own board; an I²C sensor gets its devicetree overlay wired correctly.
- **Debug a running board without reflashing.** *Build, flash & debug* can skip straight to capturing and analysing logs when the device already runs the firmware you want to inspect.

### Fixed

- **The free-tier "tokens left" counter is accurate.** It decrements by each request's real usage and shows 0 the moment the quota is exhausted, rather than plateauing at, say, "~20k left" after the free tier ran out. Resolves the 0.1.3 known issue.
- **The token counter shows on first launch**, instead of only after switching providers and back.
- **Invite codes** can be redeemed in the free-tier panel or the quota-exhausted card, for extra free-tier tokens.
- **Windows nRF tooling detection.** `nrfutil` is found in more locations, including `NRFUTIL_HOME` and common Windows paths, fixing a spurious "nrfutil not found".
- **"What's new" reappears on updates.** Patch releases now show the note to existing users, not only to fresh installs.

### Removed

- The two-button home (*Analyze Logs* and *Generate Logging Code*), replaced by the demo and the workflow cards above. The same capabilities are reachable through *Build, flash & debug*.

## [0.1.3] - 2026-06-01

### Added

- **Run the agent without an API key.** New built-in free tier backed by a managed model hosted by Adsum Networks, no key, account, or card to evaluate the tool. Acted on the most-requested item from the previous release.
- **Instant BYOK switchover.** Adding your own key swaps the provider on the live task, no restart, the in-flight session continues.
- **Quota conversion card.** When the free quota runs out, a single-click prompt routes you to add a key and resumes the same task on your provider, instead of failing with a raw error.

### Fixed

- Quota exhaustion (HTTP 402) is handled cleanly, no spurious auto-retries or "Invalid API Response" noise.
- Rate-limit (429) responses surface a readable message instead of raw JSON.
- Free-tier usage telemetry corrected: funnel-entry fires once per install (was firing on every step), and the BYOK-conversion event now fires on the code path the settings form actually uses.

### Known issues

- Free-tier "tokens left" chip can briefly show a stale value until the next prompt; balance is backend-authoritative and harmless. *(Fixed in 0.1.5, the chip now decrements live and shows 0 on exhaustion.)*

## [0.1.2] - 2026-05-31

### Changed

- Reduced the extension download size by around 6 MB.
- Improved Marketplace search keywords (nRF52/53/54, Zephyr, BLE, RTT, J-Link).

### Fixed

- Toolbar and chat icons showed as blank squares, and the chat send button was missing on Linux. Icons now render correctly on macOS, Windows and Linux.

## [0.1.0] - 2026-05-26

The first release built around the **skill-first architecture**: domain expertise lives in versioned Markdown modules (workflows, actions, rules, board specs) that are loaded into the system prompt on demand based on what the agent detects in your workspace, not baked into a fixed prompt. Same model, smaller context, fewer wrong turns. Backed by an open hardware-in-the-loop benchmark.

### Added

- **Knowledge loads on demand.** The agent reads your project (`prj.conf`, build targets) and pulls only the modules that match: the BLE guide for a BLE build, the right board file, the SDK reference. Adding a new SoC, protocol, or debug procedure is a knowledge change, not a code change.
- **Enters through a workflow, never improvises.** Before any build, flash, capture, or analyze, the agent loads the matching workflow first, closing the failure mode where smaller models skip it and guess from pre-training.
- **Works across models.** Tool-call handling hardened for Claude, DeepSeek, and small local models, including mid-task model switches.
- **Reliable on Windows.** Process cleanup, J-Link resolution, and RTT log capture fixed across PowerShell, cmd, and bash.
- **Open benchmark, IoT-FirmwareDebugBench v0.1.** Six BLE tasks on real nRF52 hardware: 5/6 vs a general agent's 3/6 at 3.8x fewer tokens, same model on both sides.
- **New Adsum brand and redesigned welcome/home screen.** Supported SoCs broadened to nRF52 / nRF53 / nRF54. Pseudonymous product analytics keyed to a random install id; opt out anytime.

## [0.0.4] - 2026-03-23

### Added

- **Trademark disclaimer** added for nRF and Nordic Semiconductor compliance.
- Pseudonymous usage analytics, to catch missing dependencies and toolchain errors automatically. Opt out anytime.

### Changed

- **Major rebrand.** The extension was renamed from "nRF AI Debugger" to **Adsum IoT Coder, for nRF**.
- **Repository move.** All internal links and configuration point to the new repository.

### Fixed

- **Log analyser reliability.** Significant improvements to cross-platform UART and RTT log capture stability.
- **Terminal routing.** Named terminals (nRF Connect) were incorrectly routed to hidden `cmd.exe` processes in background execution mode.

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

[Unreleased]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.2.1...v0.3.1
[0.2.1]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.1.8...v0.2.0
[0.1.8]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.1.2...v0.1.7
[0.1.2]: https://github.com/adsumnetworks/Adsum-IoT-Coder/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/adsumnetworks/Adsum-IoT-Coder/releases/tag/v0.1.0
