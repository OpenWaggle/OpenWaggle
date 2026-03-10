# 63 — User Feedback → GitHub Issues

Status: Draft
Priority: P1
Effort: Medium

## Problem

Users have no way to report bugs, request features, or share logs from within the app. When something goes wrong, they'd need to manually collect logs, system info, and context — then navigate to GitHub Issues and write everything from scratch. This friction means most issues go unreported.

## Goal

One-click feedback flow: user opens a modal, describes the issue, optionally attaches diagnostic data, and submits. The app uses the `gh` CLI to create a GitHub issue with all context. Fallback: copy pre-formatted markdown and open the GitHub new-issue page.

## User Flow

```
User clicks "Report Issue" (settings / help menu / error display)
  → Modal opens
  → User fills: title, description, category (bug/feature/question)
  → User toggles optional attachments:
      ☑ System info (OS, app version, Electron version, Node version, arch)
      ☑ Recent logs (last N lines from today's log file)
      ☑ Last error context (if any — classified error + stack)
      ☑ Last user message (the prompt that triggered the issue)
      ☑ Model & provider in use
  → User clicks "Submit"
     → IF gh CLI is installed + authenticated:
         gh issue create on openwaggle/openwaggle repo
         → Success toast with link to created issue
     → ELSE (fallback — gh not installed or not authenticated):
         Modal shows inline notice:
           "GitHub CLI not found. Install it to submit directly from the app."
           [Install GitHub CLI →] (links to https://cli.github.com)
           — or —
           "Copy the issue content and create it manually on GitHub."
         Two fallback actions available:
           [Copy to Clipboard] — copies full pre-formatted markdown
           [Open GitHub Issues →] — opens browser to repo/issues/new
         → Toast on copy: "Issue content copied — paste it into GitHub"
```

## Architecture

### IPC Channels

```typescript
// IpcInvokeChannelMap additions
'feedback:check-gh-available': {
  args: []
  return: { available: boolean; authenticated: boolean }
}

'feedback:collect-diagnostics': {
  args: []
  return: {
    os: string           // e.g. "macOS 15.3 arm64"
    appVersion: string   // from package.json
    electronVersion: string
    nodeVersion: string
    activeModel: string | null
    activeProvider: string | null
  }
}

'feedback:get-recent-logs': {
  args: [lineCount: number]   // e.g. 100
  return: string              // raw log tail
}

'feedback:get-last-error': {
  args: [conversationId: string]
  return: { classification: string; message: string; stack?: string } | null
}

'feedback:submit-via-gh': {
  args: [payload: FeedbackPayload]
  return: { success: boolean; issueUrl?: string; error?: string }
}

'feedback:generate-markdown': {
  args: [payload: FeedbackPayload]
  return: string   // full markdown body for manual paste
}
```

### Shared Types

```typescript
// src/shared/types/feedback.ts

type FeedbackCategory = 'bug' | 'feature' | 'question'

interface FeedbackPayload {
  title: string
  description: string
  category: FeedbackCategory
  attachSystemInfo: boolean
  attachLogs: boolean
  attachLastError: boolean
  attachLastMessage: boolean
  // Resolved data (populated by main process before submission)
  systemInfo?: string
  recentLogs?: string
  lastError?: string
  lastUserMessage?: string
  modelInfo?: string
}
```

### Main Process (`src/main/ipc/feedback-handlers.ts`)

1. **`gh` detection**: `which gh` + `gh auth status` to check availability and auth
2. **Diagnostics collection**: `process.platform`, `process.arch`, `os.release()`, `app.getVersion()`, `process.versions.electron`, `process.versions.node`
3. **Log reading**: Read last N lines from today's log file at `app.getPath('logs')`
4. **Error context**: Pull from existing `getLastAgentErrorInfo()` per conversation
5. **Issue creation**: `gh issue create --repo openwaggle/openwaggle --title "..." --body "..." --label "bug|feature|question"`
6. **Markdown generation**: Format all selected data into a structured issue template

### Issue Template (generated markdown)

```markdown
## Description

{user description}

## Environment

| Field | Value |
|-------|-------|
| OS | macOS 15.3 arm64 |
| App Version | 0.1.0 |
| Electron | 40.x |
| Node | 24.x |
| Model | claude-sonnet-4-6 |
| Provider | Anthropic |

## Last Error

```
[error-classification] Error message here
Stack trace...
```

## Last User Message

> {the prompt that triggered the issue}

## Recent Logs

<details>
<summary>Last 100 log lines</summary>

```
[2026-03-10 14:30:01] [agent] Starting run...
...
```

</details>

---
*Submitted from OpenWaggle v0.1.0*
```

### Renderer (`src/renderer/src/components/feedback/`)

- **`FeedbackModal.tsx`** — main modal component
  - Title input
  - Description textarea
  - Category selector (bug/feature/question)
  - Toggle checkboxes for each attachment type
  - Preview panel (collapsible) showing what will be sent
  - Submit button (primary) + Copy & Open GitHub button (secondary, always visible)
  - gh CLI status indicator at bottom ("gh CLI: ready" / "gh CLI: not found — use copy mode")
- **`useFeedback.ts`** — hook managing modal state, gh check, submission

### Entry Points (where to open the modal)

1. **Settings panel** — "Report Issue" button in a new section or footer
2. **Error display** — "Report this issue" link on `ChatErrorDisplay` when an error is shown
3. **Help menu / command palette** — if command palette exists

## Checklist

- [ ] Create `src/shared/types/feedback.ts` with `FeedbackPayload` and `FeedbackCategory`
- [ ] Add IPC channel types to `src/shared/types/ipc.ts`
- [ ] Implement `src/main/ipc/feedback-handlers.ts` (gh check, diagnostics, log tail, issue creation, markdown gen)
- [ ] Register feedback handlers in main IPC setup
- [ ] Add preload API methods in `src/preload/api.ts`
- [ ] Add `OpenWaggleApi` type entries
- [ ] Create `FeedbackModal.tsx` with form, toggles, preview
- [ ] Create `useFeedback.ts` hook
- [ ] Add entry point in settings panel
- [ ] Add entry point on `ChatErrorDisplay`
- [ ] Add tests for feedback handlers (unit)
- [ ] Add component test for `FeedbackModal`
- [ ] Manual E2E validation

## Effort Estimate

- IPC + main handlers: ~2h
- Shared types: ~15min
- Preload bridge: ~15min
- Renderer modal + hook: ~2-3h
- Entry points wiring: ~30min
- Tests: ~1-2h
- **Total: ~6-8h of focused work**

## Open Questions

1. Which GitHub repo should issues target? `openwaggle/openwaggle` or configurable?
2. Should we sanitize/redact API keys from logs before attaching? (Yes — reuse existing token redaction patterns from `run-command.ts`)
3. Should the "last user message" attachment redact or truncate long prompts? (Suggest: truncate to 500 chars with "[truncated]")
4. Should we add GitHub issue labels automatically based on category?
5. Rate limiting — should we prevent spam submissions? (Suggest: simple cooldown, 1 submission per 60s)
