# nRF Platform Rule: Skill Loading (rules/skill-loading.md)

This rule governs how the agent discovers and loads Workflows and Actions from the `iot-knowledge` platform directory.

## Entry-Point Hierarchy (Workflows vs Actions)

- **Workflows** are the **only** valid entry points for starting a task. When a user's request matches a skill, you MUST load the corresponding Workflow file first.
- **Actions** are internal atomic subroutines. You are **STRICTLY FORBIDDEN** from loading an Action file to start a task. You may only load an Action when an active Workflow explicitly instructs you to do so (via a `MANDATORY SKILL LOAD` directive).

## Mandatory First Load

Before executing any complex task (analyzing logs, generating logging code, building, flashing, capturing logs), you **MUST** use `read_file` to load the corresponding Workflow from disk. Do not attempt to execute these tasks based on your pre-trained knowledge or general assumptions.

## Context Optimization (Load Once)

If you have *already loaded* a specific skill file during the current ongoing task (for example, you are on iteration 2 of a debug loop), **DO NOT load it again**. Rely on the instructions already present in your conversational history to save context limits. Only re-load a file if it is missing from your immediate context or you need to correct a mistake.

## Skill Discovery Workflow

1. Read `PLATFORM.md` → identifies which Workflow matches the user's request
2. Load the Workflow `.md` file → the Workflow orchestrates the full task
3. The Workflow instructs you to load specific Actions → load each Action when instructed
4. Execute the Action as described → return to the Workflow for the next step
