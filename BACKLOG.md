# HiveCode Backlog

## Bugs

### B1: API errors not shown to user
**Severity:** High
**Where:** Renderer — chat store + message list UI
**Description:** When the agent stream returns a `RUN_ERROR` (e.g., insufficient credits, rate limits, invalid API key), the chat store sets `status: 'error'` but the UI shows "(no response)" instead of the actual error message. The user has no idea what went wrong.
**Fix:** Surface the error message in the chat UI — either as an inline error banner in the message list or as a toast notification. The error text is already available via the `error` event payload.

### B2: `testApiKey` errors can freeze the settings dialog
**Severity:** Medium
**Where:** `src/main/ipc/settings-handler.ts`
**Description:** If `testApiKey` throws an unexpected error inside TanStack AI's stream internals, the IPC promise may hang, leaving the settings dialog unresponsive. The try/catch should cover this, but TanStack AI's internal error logging suggests some errors may escape the `for await` scope.
**Fix:** Add a timeout wrapper around the test functions. If the test doesn't resolve within ~10s, return `false`.

### B3: No loading/feedback state when testing API keys
**Severity:** Low
**Where:** Settings dialog UI
**Description:** When pressing "Test", there's no spinner or visual feedback that the test is in progress. Combined with B2, the user doesn't know if the app froze or is still working.
**Fix:** Show a spinner on the Test button while `isTestingKey` is true, and show success/failure result inline.

## UI / Visual Polish

### V1: Tool call blocks look raw and unformatted
**Priority:** High
**Where:** `src/renderer/src/components/chat/ToolCallBlock.tsx`
**Description:** Tool calls dump raw JSON for arguments and results with no formatting. All tool blocks look identical regardless of type. Should have:
- Syntax-highlighted JSON or summarized args (e.g., `glob({ pattern: "*.md" })` instead of raw `{ "pattern": "*.md" }`)
- Distinct visual treatment per tool type (file read vs command vs glob)
- Properly formatted results — parse JSON errors instead of dumping `{"error":"Unexpected token..."}` as-is
- Cleaner collapse/expand — collapsed should show a one-line summary, expanded should show formatted content

### V2: Tool result errors displayed as raw JSON
**Priority:** High
**Where:** Tool call result rendering
**Description:** When a tool returns an error (e.g., glob returns `{"error":"Unexpected token...is not valid JSON"}`), it's rendered as a raw JSON string. Should parse and display a clean error message.

### V3: "Done 0ms" badges look cheap
**Priority:** Medium
**Where:** `ToolCallBlock.tsx`
**Description:** The green "Done" badge with "0ms" on every tool call is visually noisy and uninformative (0ms means we're not timing tools accurately). Either show accurate timing or remove the duration. The badge styling needs refinement — less prominent, better typography.

### V4: No visual hierarchy in chat messages
**Priority:** High
**Where:** Message list components
**Description:** Text, tool calls, and results all have the same visual weight. Need clear distinction between:
- User messages (right-aligned or distinctly styled)
- Assistant text (clean markdown rendering with proper typography)
- Tool call groups (subtle, collapsible, secondary importance)
- Inline code and code blocks (syntax highlighting)

### V5: Overall layout lacks structure
**Priority:** High
**Description:** Compared to polished coding agents (Codex, Cursor), the app lacks:
- Conversation sidebar for thread navigation
- Proper spacing and padding system
- Visual breathing room — everything feels cramped
- A clear content width constraint (text spans too wide)
- Proper dark theme refinement (not just "everything is dark gray")

### V6: Markdown rendering in assistant messages
**Priority:** High
**Where:** Message text rendering
**Description:** Assistant responses need proper markdown rendering with:
- Headings, bold, italic, lists
- Fenced code blocks with syntax highlighting and language labels
- Inline code with distinct background
- Links styled properly
- Tables if present

### V7: Input area needs polish
**Priority:** Medium
**Where:** Chat input component
**Description:** The input bar is minimal and lacks:
- Auto-resize for multi-line input
- Shift+Enter for newlines
- Clear visual distinction from the chat area
- Character/token count indicator (optional)

## UX Improvements

### U1: Show error messages in chat
**Priority:** High
**Description:** When an agent run fails, display the error as a styled message in the chat (e.g., red/amber banner with the error text). Currently errors are swallowed into "(no response)".

### U2: Per-message model indicator
**Priority:** Medium
**Description:** Each `Message` stores which model generated it. Show a subtle model badge on assistant messages so users can see which model was used, especially when switching models mid-conversation.

### U3: Conversation sidebar
**Priority:** Medium
**Description:** Add a sidebar listing past conversations. Currently the conversation title shows in the header but there's no way to browse or switch between conversations from the UI.

### U4: Retry failed messages
**Priority:** Medium
**Description:** When a message fails (error state), allow the user to retry sending it without having to retype.

### U5: Streaming state indicator
**Priority:** Low
**Description:** Show a more visible indicator when the agent is streaming (animated dots, pulsing cursor, etc.) so the user knows a response is coming.

### U6: Model availability feedback
**Priority:** Low
**Description:** When a user tries to send a message with a model whose API key is not configured, show a clear error directing them to settings — don't silently fail.

## Technical Debt

### T1: Remove `activeConversation.model` ambiguity
**Priority:** Medium
**Description:** `Conversation.model` stores the model used at creation time, but individual messages also have a `model` field. The conversation-level `model` is redundant and was causing the model selector to get stuck (fixed). Consider deprecating `Conversation.model` or repurposing it as "last used model."

### T2: Error boundary for renderer
**Priority:** Medium
**Description:** Add a React error boundary at the app root to catch and display unhandled renderer errors gracefully instead of a blank screen.

### T3: Settings validation at startup
**Priority:** Low
**Description:** Validate settings on load — check if saved `defaultModel` is still in `SUPPORTED_MODELS`, verify API key format, etc. Currently stale settings can cause silent failures.
