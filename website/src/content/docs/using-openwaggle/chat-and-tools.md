---
title: "Chat & Tools"
description: "How conversations work, the built-in agent tools, the approval system, and execution modes."
order: 1
section: "Using OpenWaggle"
---

## Conversations

### Starting a Conversation

Click the **New Thread** button (pencil icon) in the sidebar to create a new conversation. You can also send a message directly from the welcome screen.

Each conversation is tied to a **project folder**. Select a project from the welcome screen or the sidebar to give the agent access to your codebase.

### Welcome Screen

When a conversation has no messages, you'll see starter prompts to help you get going:

- **"Build a coding game in this repo"**
- **"Draft a one-page summary of this app"**
- **"Create a refactor plan for this feature"**

Click any starter prompt to send it as your first message, or type your own.

### Thread Management

The sidebar shows all conversations grouped by project:

- **Sort threads** — Click the sort menu to order by recent, oldest, name, or thread count.
- **Delete threads** — Hover over a thread and click the delete button.
- **Switch threads** — Click any thread to make it active.
- **Project groups** — Threads are grouped by their associated project folder. Unassigned threads appear in their own group.
- **Archive project groups** — Removing a project group archives its threads instead of deleting them. Restore them later from **Settings > Archived threads**.

### Messages

User messages appear right-aligned in dark bubbles. Assistant messages appear left-aligned with the model name shown as a badge.

Assistant messages can contain:
- **Text** — Rendered as markdown with syntax highlighting, tables, and GFM support.
- **Tool calls** — Expandable blocks showing what the agent did (details below).
- **Reasoning blocks** — Collapsible sections showing the model's chain of thought (when using models with extended thinking).

## Built-in Tools

The agent has access to tools for working with your project files and system.

### Read-Only Tools (No Approval Needed)

These tools execute immediately without asking for permission:

| Tool | Description |
|------|-------------|
| **Read file** | Read file contents from your project. |
| **Find files** | Find files matching glob patterns (e.g., `**/*.ts`). |
| **List files** | List directory contents. |
| **Search the web** | Search the web and return results. |
| **Ask user** | Ask you clarifying questions when the agent needs more context. |

### Tools That Require Approval

These tools modify files or run commands and require your explicit approval:

| Tool | Description |
|------|-------------|
| **Write file** | Create or overwrite a file. Shows a diff of before/after content. |
| **Edit file** | Find-and-replace within a file. Shows a diff. |
| **Run command** | Execute a shell command in your project directory. |
| **Fetch URL** | Fetch content from a URL. |

### Skills & Standards

The agent can also load project-specific skills and instructions during a conversation. See [Skills System](/docs/extending/skills-system) for details.

## Tool Call Display

When the agent uses a tool, it appears as a collapsible block in the conversation:

- **Status icon** — Spinner (running), clock (waiting), checkmark (success), or X (failed).
- **Action text** — Human-readable description (e.g., "Reading src/app.ts", "Running npm test").
- **Execution time** — Shown after completion.
- **Expandable details** — Click to see arguments, full output, and diffs.

For file write/edit operations, the expanded view shows an inline diff of the changes.

## Approval System

When the agent wants to execute a potentially destructive operation (write file, edit file, run command, or use an MCP tool), an **approval banner** appears:

- Shows the tool name and details (e.g., the command to run or file to modify).
- **Approve** (green checkmark) — Allow the operation.
- **Deny** (red X) — Block the operation.

The agent pauses until you respond. If denied, it receives a rejection and can try an alternative approach.

### Execution Modes

OpenWaggle has two execution modes that control how approvals work:

- **Default permissions** — Write operations, commands, and web fetches require approval.
- **Full access** — All tools execute immediately without approval prompts. A confirmation dialog appears when switching to this mode.

Toggle the execution mode via the status bar at the bottom of the composer.

## Command Palette

Press `Cmd+K` / `Ctrl+K` or type `/` at the beginning of the composer input to open the command palette. It provides quick access to:

- **Skills** — Activate project skills inline.
- **Waggle presets** — Start a multi-agent session or load a saved team preset.

For settings, use the gear icon in the sidebar.

Use arrow keys to navigate and Enter to select.

## Error Handling

When something goes wrong, an error display appears in the conversation with:

- **Error message** — Human-readable description of what happened.
- **Suggestion** — Recommended action (when available).
- **Show details** — Expandable section with the full error trace.
- **Action buttons**:
  - **Open Settings** — For authentication errors, takes you to Connections.
  - **Retry** — Re-send the failed message.
  - **Copy** — Copy the error to clipboard.
  - **Open Logs** — Open the app logs directory for debugging.
  - **Dismiss** — Remove the error display.

## Command Safety

When the agent runs shell commands, the child process receives a filtered environment — your API keys and other sensitive environment variables are never exposed to commands the agent runs.
