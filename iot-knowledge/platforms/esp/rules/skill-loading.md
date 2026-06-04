# ESP Platform Rule: Skill Loading (rules/skill-loading.md)

This rule governs when and how you load Workflows and Actions from the `iot-knowledge` library.

## The Operation-Gating Principle (read this first)

**Before you perform any complex ESP operation, you MUST first `read_file` the Workflow that covers it.**

This fires whenever you are *about to act*, however you got there:
- The user asked for the operation, OR you decided to do it from your own analysis, OR another Workflow handed off to it, OR the conversation moved on and the next request needs it again.

You may NOT execute a complex operation from pre-trained knowledge — the ESP-IDF API and idf.py surface change between versions, and the Workflow is the source of truth for the steps, permission gates, error handling and Action chain. "Loading" a Workflow is simply `read_file` on its markdown; there is no separate load tool.

## Operation → Workflow

| About to do (the operation) | Workflow to load first |
|---|---|
| Build firmware · Flash firmware · run the Build → Flash → Capture → Analyze → Fix cycle · diagnose a crash/panic/WDT/brownout | `platforms/esp/workflows/debug-loop.md` |
| Scaffold / generate a new ESP-IDF app (Wi-Fi, sensor, web dashboard, MQTT…) | `platforms/esp/workflows/iot-app-generator.md` |
| Add `ESP_LOG*` instrumentation to existing source | `platforms/esp/workflows/log-generator.md` |

If an upcoming operation matches no row, you are not in a Workflow's scope — answer from knowledge with the `AGENT-ESP.md` Scope Gate applied.

## Workflows vs Actions (Hierarchy)
- **Workflows** are the **only** valid entry points. You load them via this rule.
- **Actions** (`platforms/esp/actions/*.md`) are atomic subroutines invoked *by an active Workflow* through a `MANDATORY SKILL LOAD` directive. You are **STRICTLY FORBIDDEN** from loading an Action as the first read of a task.

## Load-Once Optimization
If a Workflow or Action file is already in your current context (you read it earlier this task, e.g. on a previous debug-loop iteration), **do NOT read it again** — rely on what's already in context. Re-read only if it was truncated/compacted or you need to re-verify exact steps. Files listed under "Knowledge Already Loaded" in your system context are already present — never re-read those.

## Worked Examples
1. **Fresh chat: "flash my code to the esp32-s3"** → about to flash → read `workflows/debug-loop.md`.
2. **"build me a wifi dashboard"** → about to generate an app → read `workflows/iot-app-generator.md`.
3. **Mid-analysis you find the firmware was never flashed** → about to flash → read `workflows/debug-loop.md`.
4. **Inside debug-loop, it says load `actions/build.md` via MANDATORY SKILL LOAD** → obey the directive.
5. **"what does CONFIG_FREERTOS_HZ do?"** → matches no operation → answer directly, Scope Gate applied.
