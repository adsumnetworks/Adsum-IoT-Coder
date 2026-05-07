# Workflow: Debug Loop (workflows/debug-loop.md)

## Description
This is the core iterative loop for compiling, testing, and debugging ESP-IDF code. When the user says "Debug the project" or "Compile and test", load and follow this workflow.

## Required Skills (Do NOT skip)
Load these Actions sequentially as you step through the phases.
- `MANDATORY SKILL LOAD`: `actions/build.md`
- `MANDATORY SKILL LOAD`: `actions/flash.md`
- `MANDATORY SKILL LOAD`: `actions/capture-logs.md`
- `MANDATORY SKILL LOAD`: `actions/analyze-logs.md`

## The Loop

### Phase 1: Build
1. Use `actions/build.md` to compile the firmware.
2. If the build fails:
   - Identify the C/Kconfig syntax errors.
   - Fix the code.
   - Restart **Phase 1**.
3. If the build succeeds, proceed to **Phase 2**.

### Phase 2: Flash
1. Use `actions/flash.md` to identify the device and write the binary to the ESP32.
2. If flashing fails (e.g. timeout, permission denied), advise the user. Check the target port again.
3. If flashing succeeds, proceed to **Phase 3**.

### Phase 3: Monitor & Analyze
1. Use `actions/capture-logs.md` to start `idf.py monitor` in the BACKGROUND and redirect to a `.log` file. wait ~5-10 seconds.
2. Kill the monitor background process.
3. Use `actions/analyze-logs.md` to read the log file.
4. **Analysis Decision:**
   - **Success:** Application boots, Wi-Fi connects, no crashes. Job complete!
   - **Crash/Bug:** Look for Core Panics or WDT resets. Identify the line causing the failure.
5. Apply fixes to the source code based on your analysis.
6. Restart the loop at **Phase 1**.
