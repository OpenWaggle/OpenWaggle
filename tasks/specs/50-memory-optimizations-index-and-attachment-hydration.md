# 50 — Memory Optimizations: Conversation Index + Attachment Hydration

**Status:** Completed
**Priority:** P1
**Severity:** High
**Depends on:** None
**Origin:** User request (memory optimization follow-up)

---

## Problem

Two memory-heavy paths are active:

1. `conversations:list` fully reads/parses every conversation JSON just to produce summaries.
2. Attachment preparation sends/stores base64 attachment `source` in renderer state before a run starts.

Both create avoidable memory pressure (especially with many conversations or large PDF/image attachments).

## Implementation

- [x] Add/update a lightweight conversation summary index (`index.json`) in the conversations store
- [x] Make `listConversations()` read from index by default and fallback/self-heal from full scan
- [x] Keep index synchronized on create/save/delete/title/project-path updates
- [x] Return renderer-safe attachments from `attachments:prepare` (no binary `source`)
- [x] Hydrate binary attachment sources in main process immediately before agent execution
- [x] Preserve persisted conversation behavior (no binary data persisted)
- [x] Update/extend tests for both paths

## Files to Touch

- `src/main/store/conversations.ts`
- `src/main/store/conversations.integration.test.ts`
- `src/shared/types/agent.ts`
- `src/main/ipc/attachments-handler.ts`
- `src/main/ipc/attachments-handler.integration.test.ts`
- `src/main/ipc/agent-handler.ts`
- `src/main/ipc/multi-agent-handler.ts`
- `src/main/agent/agent-loop.ts`
- `src/main/agent/multi-agent-coordinator.ts`
- `src/main/agent/shared.ts`
- related unit tests for updated handler contracts

## Verification

- [x] `pnpm exec vitest run -c vitest.integration.config.ts src/main/store/conversations.integration.test.ts src/main/ipc/attachments-handler.integration.test.ts`
- [x] `pnpm exec vitest run -c vitest.unit.config.ts src/main/ipc/agent-handler.unit.test.ts`
- [x] `pnpm typecheck`

## Review Notes

- Added conversation summary indexing (`conversations/index.json`) with index read-first listing, fallback full scan, and index self-healing on corruption/missing index.
- Synchronized index updates on save/delete paths to avoid repeated full file scans during routine refreshes.
- Split attachment contracts into renderer-safe `PreparedAttachment` and main-runtime `HydratedAttachment`.
- `attachments:prepare` now returns metadata-only attachments; binary source is hydrated in main just-in-time in classic and multi-agent handlers.
