# Cline Project: Complete Architecture Deep Dive

**Date:** February 4, 2026  
**Comprehensive Analysis** - Understanding the Nordic Auto-Debugger Enhancement

---

## Table of Contents

1. [Project Vision](#project-vision)
2. [Overall System Architecture](#overall-system-architecture)
3. [Core Component Details](#core-component-details)
4. [Agent Loop Flow](#agent-loop-flow)
5. [Tool System Architecture](#tool-system-architecture)
6. [Nordic Tool Integration](#nordic-tool-integration)
7. [Data Flow Through System](#data-flow-through-system)
8. [Terminal Execution System](#terminal-execution-system)
9. [File & State Management](#file--state-management)
10. [Extension Initialization](#extension-initialization)
11. [Directory Structure](#directory-structure)

---

## Project Vision

### Cline: AI Coding Assistant
- **Purpose:** Autonomous coding agent that uses CLI and Editor
- **Core Capability:** Multi-step task execution with human-in-the-loop approval
- **Model Support:** Claude, GPT, Gemini, Groq, Ollama, and more
- **Tools Available:** File I/O, Terminal Execution, Browser Control, MCP Integration

### Nordic Auto-Debugger: Specialized Enhancement
- **Purpose:** Transform Cline into embedded firmware expert
- **Target:** nRF52 microcontrollers with Zephyr RTOS
- **Capabilities:** 
  - Autonomous flashing and debugging
  - Real-time log capture (RTT & UART)
  - Device management and board detection
- **Architecture:** "Brain + Hands" model
  - **Brain:** System prompt with Nordic expertise
  - **Hands:** Custom `trigger_nordic_action` tool + Python scripts

---

## Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension                            │
│                   (Cline + Nordic Addon)                         │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                              │ Messages/Commands
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Webview UI (React)                             │
│                   (Chat Interface)                               │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ postStateToWebview()
                              │
┌─────────────────────────────────────────────────────────────────┐
│                  Backend (Node.js + TypeScript)                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Controller (Orchestration)                                │   │
│  │  ├─ Task Management                                       │   │
│  │  ├─ State Persistence                                    │   │
│  │  └─ Lifecycle Management                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ▲                                    │
│                              │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Task (Agent Loop)                          [1] Context   │   │
│  │  ├─ ContextManager ────────────────────→  Manager        │   │
│  │  ├─ PromptBuilder ─────────────────────→  [2] System     │   │
│  │  ├─ ApiHandler ────────────────────────→  Prompt Builder │   │
│  │  └─ ToolExecutor ──────────────────────→  [3] Tool       │   │
│  │     ├─ TriggerNordicActionHandler        Executor        │   │
│  │     ├─ ExecuteCommandToolHandler                         │   │
│  │     ├─ ReadFileToolHandler                              │   │
│  │     ├─ WriteToFileToolHandler                           │   │
│  │     ├─ WebFetchToolHandler                              │   │
│  │     └─ [20+ other handlers]                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ▲                                    │
│                              │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Terminal Execution System                                │   │
│  │  ├─ CommandExecutor                                      │   │
│  │  ├─ VscodeTerminalManager (VSCode Terminal)             │   │
│  │  └─ StandaloneTerminalManager (Child Process)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ▲                                    │
│                              │ Command Execution                 │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ System Interaction                                        │   │
│  │  ├─ Shell Commands (west, nrfjprog, npm)               │   │
│  │  ├─ Python Scripts (nrf_rtt_logger.py, etc)            │   │
│  │  ├─ File System (read/write)                           │   │
│  │  └─ Browser Control                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
           ┌────────────────────────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌──────────────┐  ┌───────────────┐
    │   Host OS   │    │  nRF Connect │  │  Nordic Tools │
    │  (Terminal) │    │   SDK        │  │ (nrfjprog,   │
    └─────────────┘    └──────────────┘  │  west, RTT)  │
                                          └───────────────┘
```

---

## Core Component Details

### 1. Controller (`src/core/controller/index.ts`)
**Responsibility:** Global orchestration and task lifecycle management

**Responsibilities:**
- Manages VS Code extension lifecycle
- Creates and manages active `Task` instances
- Handles authentication and API configuration
- Persists state to disk
- Communicates with Webview

**Key Methods:**
```typescript
- initTask(prompt: string) → Promise<Task>  // Create new task
- cancelTask() → Promise<void>               // Abort current task
- postStateToWebview() → Promise<void>       // Sync UI state
```

**Data Stored:**
- User preferences (API keys, models, settings)
- Task history
- Conversation logs
- Custom rules (.cline/rules)

---

### 2. Task (`src/core/task/index.ts`)
**Responsibility:** The agent execution loop - implements the core "thinking and acting" cycle

**Responsibilities:**
- Loads context (files, project structure, error logs)
- Builds system prompt with dynamic rules
- Makes API requests to LLM
- Parses tool requests from LLM response
- Executes tools via ToolExecutor
- Manages task state and messages
- Handles cancellation and errors

**Key Methods:**
```typescript
- startTask() → Promise<void>
  - Initiates the agent loop
  
- recursivelyMakeClineRequests(userContent) → Promise<ClineMessage>
  - Core loop: load context → build prompt → call API → execute tools
  
- initiateTaskLoop(userContent) → Promise<void>
  - Main while loop that keeps running until task completes
```

**Task State (TaskState):**
```typescript
{
  abort: boolean,                    // Should task stop?
  didRejectTool: boolean,           // User rejected tool?
  consecutiveMistakeCount: number,  // Error tracking
  isRunning: boolean,               // Currently executing?
  activeHookExecution?: {           // Active hook info
    hookName: string,
    toolName: string,
    messageTs: number,
    abortController: AbortController
  }
}
```

---

### 3. PromptBuilder & System Prompt (`src/core/prompts/system-prompt/`)
**Responsibility:** Construct the "Brain" - system message that defines agent capabilities and rules

**Structure:**
```
System Prompt = Base Instructions + Rules + Capabilities + Tool Definitions

├─ Base Instructions
│  ├─ Role definition
│  ├─ Task approach
│  └─ General guidelines
│
├─ Rules (Injected from components)
│  ├─ Nordic Auto-Debugger rules
│  ├─ Global cline rules (.cline/rules)
│  ├─ Project rules (.cline/rules/project.md)
│  └─ Custom workflows
│
├─ Capabilities
│  ├─ Available tools list
│  ├─ File system access scope
│  ├─ Terminal execution capabilities
│  └─ Browser control
│
└─ Tool Definitions (CLI References)
   ├─ execute_command tool spec
   ├─ read_file tool spec
   ├─ write_to_file tool spec
   ├─ trigger_nordic_action tool spec  ← Nordic addition
   └─ [20+ other tool specs]
```

**Key Component: `trigger_nordic_action.ts`**
- Defines Nordic-specific tool capabilities
- Provides CLI reference with examples
- Specifies parameters (action, command, operation, transport, etc.)
- Documents best practices for Zephyr development

---

### 4. ToolExecutor (`src/core/task/ToolExecutor.ts`)
**Responsibility:** The "Hands" - dispatch and execute tool requests from the agent

**Responsibilities:**
- Register all available tool handlers
- Validate tool parameters
- Apply auto-approval rules
- Dispatch to appropriate handler
- Collect and format tool results
- Handle tool errors and retries

**Tool Registry (ToolExecutorCoordinator):**
```typescript
Tools available:
- execute_command → ExecuteCommandToolHandler
- read_file → ReadFileToolHandler
- write_to_file → WriteToFileToolHandler
- search_files → SearchFilesToolHandler
- list_files → ListFilesToolHandler
- trigger_nordic_action → TriggerNordicActionHandler  ← Nordic
- web_fetch → WebFetchToolHandler
- web_search → WebSearchToolHandler
- apply_patch → ApplyPatchHandler
- use_mcp_tool → UseMcpToolHandler
- [15+ more tools...]
```

**Tool Execution Flow:**
```
LLM Response (tool_use block)
        ▼
ToolExecutor.executeTool()
        ▼
Validate parameters & permissions
        ▼
Check auto-approval rules
        ▼
Ask user for approval (if needed)
        ▼
Dispatch to specific handler (e.g., TriggerNordicActionHandler)
        ▼
Handler executes tool logic
        ▼
Format result (success/error)
        ▼
Feed back to Task loop as user content
```

---

## Agent Loop Flow

The core agent loop is the heart of Cline's operation:

```
┌─────────────────────────────────────────────────────────────┐
│                   Task.startTask()                           │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ WHILE (!taskState.abort) {                                  │
│   ┌─────────────────────────────────────────────────────────┤
│   │ recursivelyMakeClineRequests(userContent)               │
│   │                                                          │
│   │ Step 1: LOAD CONTEXT                                   │
│   │ ├─ Read open files in editor                           │
│   │ ├─ Analyze project structure (AST, imports)            │
│   │ ├─ Search relevant code files                          │
│   │ ├─ Capture error messages from terminal                │
│   │ └─ Include user-provided context (screenshots, links)  │
│   │                                                          │
│   │ → ContextManager loads smart context (not everything)  │
│   │ → Respects token limits of chosen model               │
│   │                                                          │
│   │ Step 2: BUILD SYSTEM PROMPT                            │
│   │ ├─ Get base instructions from PromptRegistry           │
│   │ ├─ Inject rules (Nordic, global, project-specific)    │
│   │ ├─ List available tools with examples                 │
│   │ ├─ Add Nordic tool definition (trigger_nordic_action) │
│   │ └─ Format with token budgets and guidelines            │
│   │                                                          │
│   │ Step 3: BUILD MESSAGE HISTORY                          │
│   │ ├─ Previous assistant messages                         │
│   │ ├─ Previous tool results                               │
│   │ └─ User feedback and corrections                       │
│   │                                                          │
│   │ Step 4: MAKE API REQUEST                               │
│   │ ├─ Call this.api.createMessage(systemPrompt, msgs)    │
│   │ ├─ Stream response chunks as they arrive              │
│   │ ├─ Parse streaming tokens into content blocks         │
│   │ └─ Show "thinking" text to user in real-time         │
│   │                                                          │
│   │ Step 5: PARSE RESPONSE                                 │
│   │ ├─ Identify <text> blocks (agent thinking)            │
│   │ ├─ Identify <tool_use> blocks (tool requests)         │
│   │ ├─ Validate tool parameters                           │
│   │ └─ Wait for complete tool_use blocks                  │
│   │                                                          │
│   │ Step 6: EXECUTE TOOLS (if requested)                  │
│   │ ├─ FOR EACH tool_use block:                           │
│   │ │  ├─ Dispatch to ToolExecutor.executeTool()          │
│   │ │  │                                                    │
│   │ │  │  Example: trigger_nordic_action                  │
│   │ │  │  ├─ TriggerNordicActionHandler.execute()         │
│   │ │  │  ├─ Route to handleLogDevice() or execute()      │
│   │ │  │  ├─ Build Python script path                     │
│   │ │  │  ├─ Execute in nRF terminal                      │
│   │ │  │  ├─ Capture output                               │
│   │ │  │  └─ Return result                                │
│   │ │  │                                                    │
│   │ │  └─ Tool result formatted as "tool_result"          │
│   │ │                                                       │
│   │ └─ ALL tool results collected                          │
│   │                                                          │
│   │ Step 7: UPDATE STATE                                   │
│   │ ├─ Save messages to disk                              │
│   │ ├─ Update UI via postStateToWebview()                │
│   │ ├─ Update task state                                  │
│   │ └─ Check if task is complete                          │
│   │                                                          │
│   │ IF task not complete:                                  │
│   │    → Loop back with tool results as new user content  │
│   │                                                          │
│   └─────────────────────────────────────────────────────────┤
│ }                                                             │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Task Complete: Save final state, notify user                 │
└─────────────────────────────────────────────────────────────┘
```

**Key Insight:** This is a **request-response cycle** that repeats until the agent says "task complete" or hits an error.

---

## Tool System Architecture

### Tool Execution Pipeline

```
Request from LLM (tool_use block)
        │
        ├─ Tool Name (e.g., "trigger_nordic_action")
        ├─ Parameters (e.g., action: "log_device", operation: "capture")
        └─ Expected Result Format
        
        ▼
┌─────────────────────────────────┐
│ ToolExecutor.executeTool()      │
│                                 │
│ 1. Validate tool name exists   │
│ 2. Validate parameters         │
│ 3. Check permissions           │
└─────────────────────────────────┘
        ▼
┌─────────────────────────────────┐
│ Apply Auto-Approval Rules       │
│                                 │
│ Does LLM choice auto-approve?  │
│ (e.g., reading package.json)   │
└─────────────────────────────────┘
        ▼
    ┌───────────────────┐
    │ Auto-Approved?    │
    └───────────────────┘
        ▼           ▼
      YES          NO
        │           │
        ▼           ▼
    Execute    Ask User
        │      "Approve this?"
        │           │
        │       ┌───┴────┐
        │       │         │
        │      YES       NO
        │       │         │
        │       ▼         ▼
        │     Execute   Reject
        │       │
        └───────┴─────────┐
                ▼
    ┌─────────────────────────┐
    │ Get Handler from Registry│
    │ e.g., TriggerNordicAction│
    │Handler                   │
    └─────────────────────────┘
                ▼
    ┌─────────────────────────┐
    │ Execute Handler Logic   │
    │                         │
    │ handler.execute(        │
    │   config: TaskConfig,   │
    │   block: ToolUse        │
    │ ) → ToolResponse        │
    └─────────────────────────┘
                ▼
    ┌─────────────────────────┐
    │ Format Result           │
    │                         │
    │ Success: {              │
    │   type: "tool_result",  │
    │   content: "output"     │
    │ }                       │
    │                         │
    │ Error: {                │
    │   type: "tool_error",   │
    │   content: "message"    │
    │ }                       │
    └─────────────────────────┘
                ▼
    ┌─────────────────────────┐
    │ Feed Back to Task Loop  │
    │                         │
    │ Add to message history  │
    │ as "user content"       │
    │ (simulating user reading│
    │  the tool output)       │
    └─────────────────────────┘
```

---

## Nordic Tool Integration

### How Nordic Tool Fits Into Agent Loop

```
User: "Flash the firmware to the nRF52840 board"
        ▼
Agent thinks: "I need to:
  1. Build the project
  2. Flash it
  3. Check logs"
        ▼
Agent generates:
  "I'll help you. Let me build the firmware first."
        ▼
Agent requests tool:
  {
    type: "tool_use",
    name: "trigger_nordic_action",
    params: {
      action: "execute",
      command: "west build -b nrf52840dk/nrf52840 ."
    }
  }
        ▼
ToolExecutor dispatches to TriggerNordicActionHandler
        ▼
Handler.execute() flow:

  1. Validate action="execute" ✓
  2. Validate command exists ✓
  3. Route to executeInNrfTerminal()
  4. Activate nRF Connect terminal
  5. Execute: "west build -b nrf52840dk/nrf52840 ."
  6. Capture output
  7. Return result
        ▼
Tool Result back to agent:
  {
    type: "tool_result",
    content: "[BUILD SUCCESS] 2431 bytes of flash used..."
  }
        ▼
Agent continues:
  "Build succeeded! Now flashing..."
        ▼
Next tool request (flash):
  {
    name: "trigger_nordic_action",
    params: {
      action: "execute",
      command: "timeout 60s west flash"
    }
  }
        ▼
[Tool executes same way...]
        ▼
Agent requests logging:
  {
    name: "trigger_nordic_action",
    params: {
      action: "log_device",
      operation: "capture",
      port: "683335182",
      transport: "rtt",
      duration: "30",
      output: "logs/"
    }
  }
        ▼
Handler.execute() routes to handleLogDevice()
        ▼
handleLogDevice() flow:

  1. Smart transport detection
     - Port "683335182" matches 9-digit RTT serial
     - Set transport="rtt" automatically
  
  2. Resolve wrapper path
     - Get absolute path to rtt-logger
     - Make relative if possible
  
  3. Build Python script args
     - args = ["./assets/scripts/rtt-logger"]
     - args += ["--capture", "--port", "683335182"]
     - args += ["--duration", "30", "--output", "/abs/path/logs/"]
  
  4. Execute in nRF terminal
     - Command: "./assets/scripts/rtt-logger --capture --port 683335182 ..."
     - rtt-logger calls nrf_rtt_logger.py
     - Python script handles:
       * Cleanup old J-Link processes
       * Reset device
       * Start RTT capture
       * Add timestamps
       * Write to file
  
  5. Return logs path
        ▼
Agent analyzes logs and reports results
```

### Key Integration Points

**1. System Prompt Integration**
- `src/core/prompts/system-prompt/tools/trigger_nordic_action.ts`
- Defines tool for LLM with CLI reference
- Includes best practices for Zephyr/nRF development

**2. Handler Implementation**
- `src/core/task/tools/handlers/TriggerNordicActionHandler.ts`
- Implements `execute()` method
- Routes to script execution or wrapper calls

**3. Python Scripts (Assets)**
- `assets/scripts/nrf_rtt_logger.py` - RTT capture with threading
- `assets/scripts/nrf_uart_logger.py` - UART/serial capture
- `assets/scripts/rtt-logger` - Bash wrapper
- `assets/scripts/uart-logger` - Bash wrapper

**4. Terminal Integration**
- Uses CommandExecutor to run commands
- Routes to nRF terminal when available
- Falls back to generic terminal if needed

---

## Data Flow Through System

```
INCOMING DATA:
┌──────────────────┐
│ User Message     │ "Fix the BLE scanning bug"
│ + Screenshots    │
│ + File context   │
└──────────────────┘
        ▼
┌──────────────────────────────────────────┐
│ Controller.handleTaskCreation()          │
│ Creates Task instance                    │
└──────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────┐
│ Task receives user content               │
│ + Initial message                        │
│ + Optional images, files                 │
└──────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ ContextManager loads relevant context                    │
│                                                           │
│ - File system exploration (AST parsing)                │
│ - Error logs from terminal                             │
│ - Project configuration (package.json, etc)            │
│ - .cline/ rules and instructions                        │
│ - User-provided files                                  │
│                                                           │
│ → Smart context = only most relevant parts            │
│ → Fits within token budget of chosen model            │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ PromptBuilder assembles System Prompt                   │
│                                                           │
│ ├─ Role: Expert developer + Nordic firmware engineer   │
│ ├─ Rules:                                              │
│ │  ├─ Nordic-specific rules (trigger_nordic_action)  │
│ │  ├─ Global cline rules                             │
│ │  └─ Project rules                                  │
│ ├─ Capabilities:                                       │
│ │  └─ List of available tools with examples          │
│ └─ Tool definitions:                                   │
│    ├─ execute_command spec                            │
│    ├─ trigger_nordic_action spec  ← Nordic specific  │
│    └─ [20+ other tools]                              │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ Build Message History                                   │
│                                                           │
│ - Previous assistant messages                          │
│ - Previous tool requests + results                     │
│ - User feedback/corrections                            │
│ - Current message from user                            │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ API Request to LLM                                      │
│                                                           │
│ POST /messages {                                       │
│   model: "claude-3-5-sonnet",                         │
│   system: "You are...",  ← Full system prompt        │
│   messages: [...history...],                          │
│   tools: [{                                            │
│     name: "execute_command",                          │
│     description: "...",                               │
│     input_schema: {...}                               │
│   }, {                                                 │
│     name: "trigger_nordic_action",  ← Nordic tool    │
│     description: "...",                               │
│     input_schema: {...}                               │
│   }, ... more tools ...]                              │
│ }                                                       │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ LLM Response (Streaming)                               │
│                                                           │
│ <thinking>                                             │
│ The user wants me to fix a BLE bug.                   │
│ I should first read the main code...                  │
│ </thinking>                                            │
│                                                           │
│ I'll help you fix the BLE scanning bug. Let me...      │
│                                                           │
│ <tool_use name="read_file" id="read_1">               │
│   <parameter name="path">src/main.c</parameter>        │
│ </tool_use>                                            │
│                                                           │
│ <tool_use name="trigger_nordic_action" id="nordic_1">  │
│   <parameter name="action">log_device</parameter>      │
│   <parameter name="operation">capture</parameter>      │
│   <parameter name="port">683335182</parameter>         │
│   <parameter name="transport">rtt</parameter>          │
│   <parameter name="duration">30</parameter>            │
│ </tool_use>                                            │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ Task parses response into content blocks               │
│                                                           │
│ Array of:                                              │
│ - Text blocks (agent thinking)                         │
│ - Tool use blocks (structured requests)                │
│                                                           │
│ Waits for complete tool_use blocks (streaming)        │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ ToolExecutor executes each tool                        │
│                                                           │
│ For read_file:                                         │
│ → ReadFileToolHandler reads src/main.c                │
│ → Returns file contents                                │
│                                                           │
│ For trigger_nordic_action:                            │
│ → TriggerNordicActionHandler.execute()                │
│ → handleLogDevice() since action="log_device"         │
│ → Executes: ./assets/scripts/rtt-logger \             │
│             --capture --port 683335182 ...            │
│ → Returns: path to captured logs                       │
│                                                           │
│ Results formatted as "tool_result" blocks             │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ Feed results back to LLM in next iteration             │
│                                                           │
│ - Tool results become "user content" in history       │
│ - Simulates user seeing tool output                    │
│ - LLM can read results and continue reasoning         │
│                                                           │
│ Example:                                               │
│ "Tool result: BLE_EVT_USER_MEM_REQUEST received..."  │
│ "I can see the bug now. The memory isn't allocated..." │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ Repeat: Context → Prompt → API → Tools → Results      │
│                                                           │
│ Continue until:                                         │
│ - LLM says "attempt_completion" (task done)           │
│ - User cancels                                         │
│ - Error occurs                                         │
└──────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────┐
│ Final Output to User                                    │
│                                                           │
│ - Summary of changes                                   │
│ - Files modified (diffs)                              │
│ - Commands to run                                      │
│ - Links to resources                                   │
└──────────────────────────────────────────────────────────┘
```

---

## Terminal Execution System

### How Commands are Executed

```
TriggerNordicActionHandler.handleLogDevice()
  ├─ Build wrapper path
  │  └─ path.join(extensionUri, "assets/scripts/rtt-logger")
  │
  ├─ Build arguments array
  │  └─ ["./assets/scripts/rtt-logger", "--capture", "--port", "683335182", ...]
  │
  └─ Execute in nRF terminal
     └─ executeInNrfTerminal(config, command)
        │
        ├─ Activate nRF Connect terminal
        │  └─ activateNordicTerminal()
        │     └─ Searches for terminal named "nRF" or "Zephyr"
        │     └─ Creates new terminal if not found
        │
        ├─ Execute command
        │  └─ config.callbacks.executeCommandTool(command, undefined, terminalName)
        │
        └─ CommandExecutor handles execution
           │
           ├─ Determine execution mode
           │  ├─ VSCode Terminal mode (shell integration)
           │  └─ Background mode (child_process)
           │
           ├─ For VSCode Terminal:
           │  └─ VscodeTerminalManager
           │     ├─ Send command to terminal
           │     ├─ Wait for shell integration response
           │     ├─ Capture output
           │     └─ Parse exit code
           │
           ├─ For Background Execution:
           │  └─ StandaloneTerminalManager
           │     ├─ Use child_process.exec()
           │     ├─ Capture stdout/stderr
           │     ├─ Wait for exit code
           │     └─ Parse output
           │
           └─ Return result
              └─ [userRejected: boolean, output: string]
```

### Wrapper Script Execution (`rtt-logger`)

```bash
#!/bin/bash
# assets/scripts/rtt-logger

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/nrf_rtt_logger.py"

# Execute Python script with all arguments
exec python3 "$PYTHON_SCRIPT" "$@"
```

When executed:
```
Command: ./assets/scripts/rtt-logger --capture --port 683335182 --duration 30

1. rtt-logger (bash) executes
2. Finds nrf_rtt_logger.py in same directory
3. Calls: python3 nrf_rtt_logger.py --capture --port 683335182 --duration 30
4. Python script runs:
   - Validates port (683335182 = 9-digit RTT serial)
   - Kills old J-Link processes
   - Resets device
   - Starts RTT capture with JLinkRTTLogger
   - Post-processes output to add timestamps
   - Writes to output file
5. Returns to shell with exit code
```

---

## File & State Management

### Task State Persistence

```
Controller
    │
    ├─ StateManager (Config)
    │  ├─ API credentials
    │  ├─ Model selection
    │  ├─ Auto-approval rules
    │  └─ User preferences
    │
    └─ MessageStateHandler (Messages)
       ├─ Current conversation history
       ├─ Messages saved to disk
       ├─ Checkpoints for recovery
       └─ Files being edited
```

### Disk Storage Layout

```
Workspace root/
  .cline/
    ├─ rules/
    │  ├─ global.md           (Global instructions)
    │  ├─ project.md          (Project-specific rules)
    │  └─ custom.md           (User custom rules)
    │
    ├─ tasks/
    │  ├─ {taskId}/
    │  │  ├─ messages.json    (Full message history)
    │  │  ├─ metadata.json    (Task info)
    │  │  ├─ checkpoints/     (Recovery points)
    │  │  └─ edits/           (File edit history)
    │  │
    │  └─ history/
    │     └─ {taskId}.json    (Summary for history panel)
    │
    └─ storage/
       └─ [State files]

Nordic Auto-Debugger specific storage:
  logs/
    ├─ uart-logs/    (UART capture files)
    │  ├─ central-2025-02-04-14-30-45.log
    │  └─ peripheral-2025-02-04-14-30-45.log
    │
    └─ rtt-logs/     (RTT capture files)
       ├─ device-2025-02-04-14-30-45.log
       └─ timestamps-2025-02-04-14-30-45.log
```

---

## Extension Initialization

### VS Code Activation Flow

```typescript
// File: src/extension.ts

export async function activate(context: vscode.ExtensionContext) {
  
  1. Setup HostProvider
     └─ Initializes host bridge (communication layer)
  
  2. Initialize HookDiscoveryCache
     └─ For fast pre/post-task hooks
  
  3. Call initialize(context)
     ├─ Creates VscodeWebviewProvider
     │  └─ Manages UI webview
     │
     └─ Creates Controller
        ├─ Manages global state
        ├─ Sets up EventEmitter
        └─ Ready to handle tasks
  
  4. Start ClineTempManager
     └─ Cleanup old temp files periodically
  
  5. Activate Test Mode (if enabled)
     └─ For automated testing
  
  6. Register Commands
     ├─ explain-with-cline
     ├─ fix-with-cline
     ├─ add-to-cline
     ├─ improve-with-cline
     └─ [more commands...]
  
  7. Register URI Handlers
     └─ For deep links and state restoration
  
  8. Extension is ready!
     └─ Webview can now accept user messages
}
```

---

## Directory Structure

```
cline/
├── src/                          # TypeScript source code
│   ├── core/                     # Core agent logic
│   │   ├── controller/           # Global orchestration
│   │   ├── task/                 # Agent loop & execution
│   │   │   ├── index.ts          # Main Task class
│   │   │   ├── ToolExecutor.ts   # Tool dispatch
│   │   │   └── tools/
│   │   │       ├── handlers/     # All tool handlers
│   │   │       │   ├── TriggerNordicActionHandler.ts  ← Nordic
│   │   │       │   ├── ExecuteCommandToolHandler.ts
│   │   │       │   ├── ReadFileToolHandler.ts
│   │   │       │   └── [20+ more handlers]
│   │   │       ├── ToolExecutorCoordinator.ts
│   │   │       └── ToolValidator.ts
│   │   │
│   │   ├── prompts/              # System prompt assembly
│   │   │   ├── system-prompt/
│   │   │   │   ├── index.ts      # Main prompt getter
│   │   │   │   ├── tools/
│   │   │   │   │   └── trigger_nordic_action.ts  ← Nordic tool def
│   │   │   │   ├── components/   # Prompt components
│   │   │   │   └── rules/        # Nordic rules injection
│   │   │   └── registry/
│   │   │       └── PromptBuilder.ts
│   │   │
│   │   └── context/              # Context loading & management
│   │       └── context-management/
│   │           └── ContextManager.ts
│   │
│   ├── integrations/             # External integrations
│   │   ├── terminal/             # Terminal execution
│   │   │   ├── CommandExecutor.ts
│   │   │   ├── VscodeTerminalManager.ts
│   │   │   ├── StandaloneTerminalManager.ts
│   │   │   └── types.ts
│   │   ├── editor/               # File editing
│   │   └── notifications/        # User notifications
│   │
│   ├── hosts/                    # Host platform adapters
│   │   ├── vscode/               # VS Code specific
│   │   │   ├── VscodeWebviewProvider.ts
│   │   │   ├── hostbridge/       # gRPC bridge
│   │   │   └── terminal/
│   │   │       └── VscodeTerminalManager.ts
│   │   └── host-provider.ts      # Platform abstraction
│   │
│   ├── services/                 # External services
│   │   ├── auth/                 # Authentication
│   │   ├── api/                  # LLM API handlers
│   │   ├── mcp/                  # Model Context Protocol
│   │   ├── telemetry/            # Analytics
│   │   └── logging/
│   │
│   ├── extension.ts              # Entry point for VS Code
│   └── common.ts                 # Shared initialization
│
├── assets/                       # Static assets
│   ├── icons/
│   ├── scripts/                  # Utility scripts
│   │   ├── nrf_rtt_logger.py     ← Nordic RTT capture
│   │   ├── nrf_uart_logger.py    ← Nordic UART capture
│   │   ├── rtt-logger            ← Nordic wrapper (Bash)
│   │   ├── uart-logger           ← Nordic wrapper (Bash)
│   │   └─ [other scripts]
│   └── docs/
│
├── dist/                         # Compiled JavaScript (generated)
│   └── extension.js
│
├── webview-ui/                   # React UI code
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── utils/
│   │   └── App.tsx
│   └── dist/                     # Built UI
│
├── .github/                      # GitHub actions
│   └── workflows/
│       └── build-all.yml         # CI/CD pipeline (needs Windows update)
│
├── docs/                         # Documentation
│   └── architecture.md           # Architecture guide
│
├── package.json                  # Node dependencies
├── tsconfig.json                 # TypeScript config
├── esbuild.mjs                   # Build configuration
└── vsce.json                     # Packaging config (marketplace)
```

---

## Key Data Structures

### ToolUse (What LLM sends)
```typescript
interface ToolUse {
  name: string                          // "trigger_nordic_action"
  params: Record<string, any>           // { action: "log_device", operation: "capture", ... }
  id: string                            // Unique ID for this tool use
  partial?: boolean                     // Is this a partial/streaming block?
}
```

### ToolResponse (What handler returns)
```typescript
type ToolResponse = Array<{
  type: "text" | "tool_result" | "tool_error"
  text?: string                         // For text type
  content?: string                      // For result/error
  isError?: boolean                     // For marking errors
}>
```

### TaskConfig (Passed to handlers)
```typescript
interface TaskConfig {
  taskId: string
  ulid: string
  cwd: string                           // Current working directory
  context: vscode.ExtensionContext
  taskState: TaskState                  // Mutable task state
  messageState: MessageStateHandler
  api: ApiHandler                       // LLM client
  
  // Callbacks to Task
  callbacks: {
    say: (type, text?, images?, files?, partial?) => Promise<void>
    ask: (type, text?, partial?) => Promise<response>
    executeCommandTool: (cmd, timeout?, terminal?) => Promise<[rejected, output]>
    // ...15 more callbacks
  }
  
  // Services
  services: {
    mcpHub: McpHub
    diffViewProvider: DiffViewProvider
    // ...5 more services
  }
}
```

---

## Summary: How Everything Connects

1. **User sends message** → Controller creates Task
2. **Task enters loop** → Load context, build prompt, call LLM
3. **LLM responds with tool requests** → ToolExecutor dispatches
4. **Tools execute** (including `trigger_nordic_action`)
5. **Nordic handler** routes to Python scripts or terminal commands
6. **Python scripts** interact with hardware (nRF52 devices)
7. **Results feed back** to LLM as next input
8. **Loop continues** until task completes
9. **Final state saved** to disk and UI updated

### Nordic Tool Special Role

The `trigger_nordic_action` tool:
- Sits at the **intersection of AI reasoning and embedded hardware**
- Provides the **"hands" for firmware operations**
- Works alongside other tools (read_file, execute_command) in the **agent's workflow**
- Is defined in **system prompt** so LLM knows about it
- Is implemented as **handler** that orchestrates Python scripts
- Executes in **nRF terminal** to maintain environment

This architecture allows the LLM to reason about embedded systems naturally, requesting Nordic-specific operations just like it would request file reads or terminal commands.

