# Adsum nRF terminal — current architecture (uncommitted, F5 testing)

Reference doc only, not shipped. Mirrors the actual code in `executeNordicCommand.ts` / `nordicEnvResolver.ts` / `TriggerNordicActionHandler.ts`.

**FIXED:** `ambiguous` no longer falls to Tier 3. It now returns `needsChoice` → the agent asks you once → re-calls with `ncs_version` → persisted per project. The extension's own picker should no longer appear on a blank "create prototype" with 2+ NCS installed.

## Tier selection

```mermaid
flowchart TD
    A[Agent runs nrf_device_tool command] --> B{needs toolchain?<br/>west / cmake / ninja / dtc / menuconfig}
    B -- no: logger, nrfutil device --> C[TIER 1<br/>bare command in 'Adsum nRF'<br/>nrfutil on PATH]
    B -- yes --> D[selectNcsInstall<br/>explicit > persisted > project pin > single install]
    D --> AMB{ambiguous AND<br/>sdk-manager usable?}
    AMB -- yes --> ASK[needsChoice<br/>agent asks user once,<br/>re-calls with ncs_version<br/>→ persisted per project]
    AMB -- no --> E{resolved to ONE version<br/>AND sdk-manager usable?}
    E -- no: none / sdk-manager unusable --> F[TIER 3<br/>nRF Connect extension terminal<br/>last resort, may show its picker]
    E -- yes --> G[extractToolchainEnv via nrfutil]
    G -- succeeds --> H[TIER 1<br/>env incl. ZEPHYR_BASE injected<br/>bare command runs clean]
    G -- fails --> I[TIER 2<br/>visible wrap:<br/>nrfutil sdk-manager toolchain launch -- cmd]
```

## Why it still falls to the nRF terminal (Tier 3)

Only when we genuinely cannot self-source — no real choice to make ourselves:

| Case | Why |
|---|---|
| Zero NCS versions detected by `sdk-manager` | `none` — nothing to pick from |
| `nrfutil sdk-manager` itself not resolvable | can't self-source at all |

**Ambiguous (2+ NCS, no pin) no longer lands here** — it's now handled by our own ask-once flow (`needsChoice`) instead of deferring to the extension's picker.

Once a project *is* open, `selectNcsInstall` finds a pin (build artifact or west manifest) → resolves to one version → Tier 1/2, no picker, stays in `Adsum nRF`. That part was already working as designed.

## FIXED: "Terminal has already been disposed"

Root cause: two **independent** terminal trackers existed for the same physical terminal —
ours (`_adsumNrfTerminal` in `executeNordicCommand.ts`) and the host's own `TerminalRegistry`
(used by `executeCommandTool` to look the terminal up **by name** right after we hand it back).

```mermaid
sequenceDiagram
    participant Cmd1 as Build #1 (env A)
    participant Us as prepareAdsumNrfTerminal
    participant VSCode
    participant Registry as host TerminalRegistry
    participant Cmd2 as Build #2 (env B, e.g. version switch)

    Cmd1->>Us: need terminal, env A
    Us->>VSCode: createTerminal("Adsum nRF", env A)
    Registry->>VSCode: (later) adopts it by NAME when executeCommandTool runs
    Cmd2->>Us: need terminal, env B (different signature)
    Us->>VSCode: existing.dispose()
    Us->>VSCode: createTerminal("Adsum nRF", env B)  ← same name, new object
    Note over Registry: exitStatus on the OLD terminal<br/>is only set when onDidCloseTerminal<br/>FIRES — not synchronous with dispose()
    Cmd2->>Registry: getOrCreateTerminal(name="Adsum nRF")
    Registry-->>Cmd2: may still return the OLD (disposed) entry
    Cmd2->>VSCode: oldTerminal.show() → 💥 "already disposed"
```

Fix: `prepareAdsumNrfTerminal` now **awaits** `onDidCloseTerminal` for the old terminal before
creating its same-named replacement, so the registry never sees a same-named pair where one is
already dead. Only adds latency on the (uncommon) path where the env actually changes — the
common reuse path is untouched.

## Version pin source (project open case)

```mermaid
flowchart LR
    P[detectProjectSdk] --> Q{west manifest VERSION<br/>file readable?}
    Q -- yes --> R[pin: source=manifest<br/>topology=workspace]
    Q -- no --> S{ncs_version.h found<br/>under any build*/ dir?}
    S -- yes --> T[pin: source=build<br/>topology=workspace or freestanding]
    S -- no --> U[no pin → falls to ambiguous/single logic]
```

Not a guess — it's read from an actual file (manifest pin or compiled build header), never inferred.
