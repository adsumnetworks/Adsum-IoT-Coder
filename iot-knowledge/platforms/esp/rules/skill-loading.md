# ESP32 Platform Rule: Skill Loading (rules/skill-loading.md)

This rule governs how the agent discovers and loads Workflows and Actions from the `iot-knowledge` platform directory.

## Entry-Point Hierarchy (Workflows vs Actions)

- **Workflows** are the **only** valid entry points for starting a task. When a user's request matches a skill (e.g. generating a Wi-Fi Dashboard, or debugging firmware), you MUST load the corresponding Workflow `.md` file first.
- **Actions** are internal atomic subroutines. You are **STRICTLY FORBIDDEN** from loading an Action `.md` file to start a task. You may only load an Action when an active Workflow explicitly instructs you to do so (via a `MANDATORY SKILL LOAD` directive).

## Mandatory First Load

Before executing any complex task (analyzing logs, generating web server code, building, flashing, or capturing logs), you **MUST** read the contents of the corresponding Workflow file from disk. Do not attempt to execute these tasks based on your pre-trained knowledge or general assumptions about ESP32 development. The ESP-IDF API changes frequently; rely on the provided knowledge.

## Context Optimization (Load Once)

If you have *already loaded* a specific skill file during the current ongoing task (for example, you are on iteration 2 of the `debug-loop`), **DO NOT load it again**. Rely on the instructions already present in your conversational history to save context limits. Only re-load a file if it is missing from your immediate context or you need to correct a mistake.

## Skill Discovery Workflow

1. Read `PLATFORM.md` → identifies which Workflow matches the user's request.
2. Load the Workflow `.md` file → the Workflow orchestrates the full task.
3. The Workflow instructs you to load specific Actions → load each Action exactly when instructed.
4. Execute the Action exactly as described → return to the Workflow instructions for the next step.
