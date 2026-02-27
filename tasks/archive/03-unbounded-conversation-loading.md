# 03 — Unbounded Conversation Loading

**Status:** Completed
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-03

---

## Problem

`src/main/store/conversations.ts:188` — `listConversations()` reads every `.json` file in the conversations directory via `Promise.all()` with no pagination or concurrency limit. Each file is fully read, JSON-parsed, and Zod-validated.

For a user with 200+ conversations, this means 200 concurrent `readFile` calls, 200 `JSON.parse` calls, and 200 Zod validations — all on startup, all unbounded.

## What Exists

- `listConversations()` at line 183–217: `Promise.all(files.map(async ...))` — no limit
- Returns `ConversationSummary[]` which only needs `id`, `title`, `projectPath`, `messageCount`, `createdAt`, `updatedAt` — the full message array is parsed and discarded

## Implementation

**Option A (recommended):** Store a lightweight `index.json` in the conversations directory with summary metadata. Update it atomically on save/delete. `listConversations()` reads only the index file. Fall back to full scan if index is missing or corrupt.

**Option B:** Read only the first ~500 bytes of each file (enough for the top-level fields before `messages`), or use a streaming JSON parser that extracts metadata without parsing the full message array.

**Option C (minimum):** Add concurrency limiting — process at most 10 files in parallel using a simple semaphore.

- [x] Implement chosen option
- [x] Add a `limit` parameter to `listConversations(limit?: number)` for future pagination support

## Files to Touch

- `src/main/store/conversations.ts` — `listConversations()`, `saveConversation()`, `deleteConversation()`
- `src/shared/types/ipc.ts` — optionally add `limit` param to `'conversations:list'`

## Tests

- Unit: index-based listing returns correct summaries
- Unit: fallback to full scan when index missing
- Unit: concurrent read limit prevents I/O exhaustion

## Review (2026-02-27)

- Confirmed Option A + C are implemented in `src/main/store/conversations.ts`:
  - Conversation summary index (`index.json`) with rebuild fallback when missing/corrupt.
  - Bounded scan fallback with `CONVERSATION_LOAD_CONCURRENCY = 10`.
  - `listConversations(limit?: number)` applies optional slicing.
- Wired optional `limit?: number` through IPC for future pagination:
  - `src/shared/types/ipc.ts`
  - `src/preload/api.ts`
  - `src/main/ipc/conversations-handler.ts`
- Added integration coverage for optional limit behavior:
  - `src/main/store/conversations.integration.test.ts`
- Verification:
  - `pnpm test:integration -- src/main/store/conversations.integration.test.ts` (pass)
  - `pnpm check` (pass)

## Risk if Skipped

App startup degrades linearly with conversation count. At 500+ conversations, expect multi-second freezes on the main thread.
