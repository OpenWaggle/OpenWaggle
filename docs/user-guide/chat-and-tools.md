# Chat & Agent Tools

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

### Messages

User messages appear right-aligned in dark bubbles. Assistant messages appear left-aligned with the model name shown as a badge.

Assistant messages can contain:
- **Text** — Rendered as markdown with syntax highlighting, tables, and GFM support.
- **Tool calls** — Expandable blocks showing what the agent did (details below).
- **Reasoning blocks** — Collapsible sections showing the model's chain of thought (when using models with extended thinking).

## Built-in Tools

The agent has access to tools for working with your project files and system. Tools are organized by their safety level.

### Read-Only Tools (No Approval Needed)

These tools execute immediately without asking for permission:

| Tool | Description |
|------|-------------|
| **readFile** | Read file contents (up to 1 MB). Supports partial reads via `maxLines`. |
| **glob** | Find files matching glob patterns. Returns up to 200 matches. Automatically ignores `node_modules`, `.git`, `dist`, and `out`. |
| **listFiles** | List directory contents with file sizes, up to 3 levels deep. |
| **askUser** | Ask you multiple-choice questions when the agent needs clarification (1-4 questions per call). |

### Write Tools (Approval Required)

These tools modify files and require your explicit approval before executing:

| Tool | Description |
|------|-------------|
| **writeFile** | Create or overwrite a file. Auto-creates parent directories. Shows a diff of before/after content. |
| **editFile** | Find-and-replace exact string matches within a file. The match must appear exactly once. Shows a diff. |
| **runCommand** | Execute a shell command in your project directory. 30-second timeout, 1 MB output buffer. |
| **webFetch** | Fetch content from a URL (HTTP/HTTPS only). HTML is converted to plain text. 5 MB response limit. |

### Skill & Standards Tools

| Tool | Description |
|------|-------------|
| **loadSkill** | Load full instructions from a project skill mid-conversation. |
| **loadAgents** | Load scoped AGENTS.md instructions for a specific path. |

## Tool Call Display

When the agent uses a tool, it appears as a collapsible block in the conversation:

- **Status icon** — Spinner (running), clock (waiting), checkmark (success), or X (failed).
- **Action text** — Human-readable description (e.g., "Reading src/app.ts", "Running npm test").
- **Execution time** — Shown after completion.
- **Expandable details** — Click to see arguments, full output, and diffs.

For file write/edit operations, the expanded view shows a side-by-side diff of the changes.

## Approval System

When the agent wants to execute a potentially destructive operation (write file, edit file, run command, or use an MCP tool), an **approval banner** appears:

- Shows the tool name and details (e.g., the command to run or file to modify).
- **Approve** (green checkmark) — Allow the operation.
- **Deny** (red X) — Block the operation.

The agent pauses until you respond. If denied, it receives a structured rejection and can try an alternative approach.

### Execution Modes

OpenWaggle has two execution modes that control how approvals work:

- **Default permissions** (sandbox) — Write operations and commands require approval. This is the default for new installations.
- **Full access** — All tools execute immediately without approval prompts. A confirmation dialog appears when switching to this mode.

Toggle the execution mode via the status bar at the bottom of the composer.

## Attachments

Attach files to your messages for the agent to analyze:

### Supported Formats

- **Text files** — Content extracted directly.
- **PDFs** — Text extracted with page structure preserved.
- **Images** — Sent natively to providers that support vision (Anthropic, OpenAI, Gemini). OCR text extraction used as fallback for other providers.

### How to Attach

- Click the **+** button in the composer toolbar.
- Or drag and drop files onto the composer.

Up to **5 files** can be attached per message. Attachment chips appear above the text input showing filenames. Click the X on any chip to remove it.

Attachments are stored as metadata only — binary content is not persisted in conversation history.

## Voice Input

OpenWaggle includes local speech-to-text powered by Whisper, running entirely on your machine.

### How to Use

1. Click the **microphone** button in the composer toolbar.
2. Speak your message. You'll see a live audio waveform and duration timer.
3. Press the **stop** button (square icon) to end recording.
4. The transcript appears in the composer input for review before sending.
5. Press **Enter** to send, or edit the transcribed text first.

If you press Enter or the send button while recording, it automatically stops recording, transcribes, and sends in one step.

### Privacy

All audio processing happens locally using the Whisper Tiny model. No audio data is sent to any external service. Models are cached in your app data directory.

## Command Palette

Press `Cmd+K` / `Ctrl+K` or type `/` at the beginning of the composer input to open the command palette. It provides quick access to:

- **Skills** — Activate project skills inline.
- **Waggle presets** — Start a multi-agent session.
- **Settings** — Jump to specific settings sections.

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

## Run Summary

After the agent finishes responding, a **run summary** line shows the total response time. If the response included multiple phases (thinking, tool calls, synthesis), each phase's duration is listed.

## Command Output Safety

Sensitive output from shell commands (API keys, tokens, private keys, GitHub tokens) is automatically redacted before being shown in the conversation and in logs. This prevents accidental exposure of credentials in tool output.

The child process environment is also filtered — only safe variables (`PATH`, `HOME`, `SHELL`, `TERM`, `LANG`, `USER`, `TMPDIR`) are passed to subprocesses, so your API keys and other sensitive environment variables are never exposed to commands the agent runs.
