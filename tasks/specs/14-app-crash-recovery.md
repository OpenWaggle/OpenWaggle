# 14 — App Crash Recovery

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-22

---

## Problem

If the Electron app crashes or is force-quit during an active agent run, the in-flight streaming state is lost entirely. The user sees an incomplete response with no indication that the run was interrupted.

## Implementation

- [ ] On agent run start, write a `{conversationId}.lock` file with `{ startedAt, modelId, lastChunkAt }`
- [ ] On normal run completion, delete the lock file
- [ ] On app startup, scan for orphaned lock files. For each:
  - Load the conversation and check if the last message is incomplete
  - Show a banner: "A previous run was interrupted. The last response may be incomplete."
- [ ] Optionally: offer a "Continue" button that resends the last user message

## Files to Touch

- `src/main/agent/agent-loop.ts` — lock file write/delete
- `src/main/store/conversations.ts` — orphan detection on startup
- `src/renderer/src/components/chat/ChatPanel.tsx` — interrupted run banner

## Tests

- Unit: lock file created on run start, deleted on completion
- Unit: orphaned lock detected on startup
- Unit: incomplete message flagged correctly
