# Prototype Workflow (workflows/prototype.md)

> **SCAFFOLD — co-founder to author.** Placeholders below mark every decision that requires
> a curated verified-sample index and real testing. Do NOT invent protocol specifics.

**Triggered by:** Task text contains `scaffold a new nRF prototype` or `Start a new nRF/Zephyr prototype`

This workflow guides the user from zero to a buildable nRF/Zephyr scaffold selected from a
curated list of verified Nordic samples. No project folder is required at entry — the workflow
asks the user where to create the project before writing any files.

---

## Step 0: Scope gate (prototype exception)

This workflow is explicitly exempt from the Scope Gate's "project must exist" check.
Proceed without requiring `CMakeLists.txt`, `prj.conf`, or `src/` in the workspace.

---

## Step 1: Ask what the user is building

Use `ask_followup_question`:

> "What are you building? Give me a brief description — e.g. 'BLE peripheral that streams sensor
> data', 'Thread border router', 'USB HID device'. I'll match it to the right Nordic sample."

---

## Step 2: Match to a verified sample

<!-- TODO (co-founder): populate the verified sample index -->
<!-- Map user intent → official Nordic sample repo path, confirmed to build on NCS <version> -->

| User intent (examples) | Verified sample | NCS version confirmed |
|---|---|---|
| TODO | TODO | TODO |

If no sample matches, tell the user clearly:
> "I don't have a verified sample for that combination yet. The safest path is to open a Nordic
> sample yourself in nRF Connect for Desktop, then open that folder here and ask me to add features."

Do NOT invent a sample path or guess at Kconfig values.

---

## Step 3: Ask where to create the project

Use `ask_followup_question`:

> "Where should I create the project? Give me a parent folder path — I'll create a subdirectory
> there named after your project."

Validate that the path exists with `list_files` before proceeding.

---

## Step 4: Scaffold the project

<!-- TODO (co-founder): define exact scaffold steps per sample -->
<!-- Minimum: copy verified sample source, update project name in CMakeLists.txt, confirm build -->

Steps (placeholder):
1. Copy verified sample files to the chosen location.
2. Update `CMakeLists.txt` `project()` name.
3. Confirm the directory structure with `list_files`.
4. Offer to open the new folder: *"Project created. Want me to open it in VS Code now?"*

---

## Step 5: Offer the next step

On completion, hand off to the Debug Loop workflow:
> "Scaffold is ready. Want me to build it now to confirm everything compiles?"

If the user agrees, load `platforms/nrf/workflows/debug-loop.md` and follow it.
