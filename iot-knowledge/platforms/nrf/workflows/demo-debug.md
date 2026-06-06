# Demo Debug Workflow (workflows/demo-debug.md)

**Triggered by:** Task text starts with `Demo:` or contains `[ADSUM_DEMO:`

This workflow runs the one-click demo. The task message already contains the absolute paths to
pre-captured RTT logs and real NCS source files copied into the extension's global storage.
Do NOT attempt device discovery or live capture — the data is already available.

---

## Step 1: Read all four files (mandatory — do not skip)

The task message lists four file paths. Read them all with `read_file` before forming any conclusion:
1. Central RTT log
2. Peripheral RTT log
3. Central `main.c` source
4. Peripheral `main.c` source

**Context budget:** Only read the paths provided. Do not scan the workspace or read other files.

---

## Step 2: Analyze

Cross-reference the logs and the source:

- **Logs:** what connects, what fails, what is silent.
- **Source:** locate the function where BLE service discovery completes and handles are assigned.
  Look for missing calls that would be needed to receive notifications from the peripheral.

**When the peripheral cannot send:** The sender is not the bug — it can only notify subscribed clients. Check which subscription calls the central made after discovery. Only cite API names that appear verbatim in the source — do not invent function names.

**Do not assume the bug before reading.** Let the files speak.

---

## Step 3: Produce the structured response

Write your findings in this exact order:

### Symptom
One or two sentences describing what the logs show is going wrong (observable behaviour, not cause).

### Root cause
Name the exact function in the source. Quote the line or call that is missing.
Reference the log timestamp or log line that confirms the symptom.

### Fix
A minimal code snippet — what to add and exactly where. Show context lines so the placement is clear.

### Why it works
One sentence.

---

## Step 4: End the task

End your message with exactly:
```
<!--TASK_COMPLETE-->
```
Then on the next line:
```
Your turn — ask me anything about this bug, or connect your own boards to debug a live issue.
```

---

## Scope rules for this demo

- Do NOT invoke device discovery (`nrfutil device list`).
- Do NOT attempt to build or flash.
- Do NOT ask the user to open a project or plug in hardware.
- The Scope Gate exception for `[ADSUM_DEMO:` is already active — no project check needed.
- This is a first-impression surface: be concise, clear, and confident.
