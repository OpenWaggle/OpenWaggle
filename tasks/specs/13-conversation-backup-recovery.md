# 13 — Conversation Backup & Recovery

**Status:** In Progress
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-19

---

## Problem

Conversations are stored as individual JSON files. If a file is corrupted (partial write during crash, disk full, OS kill during save), that conversation is lost. `loadConversation()` has Zod validation that will reject corrupt JSON, but there's no backup, no recovery, and no user notification.

## Implementation

- [ ] On `saveConversation()`: write to a `.tmp` file first, then `rename()` atomically
- [ ] Keep one previous version as `{id}.json.bak` (rotated on each save)
- [ ] On load failure, attempt to load the `.bak` file
- [ ] On load failure with no backup: surface a clear error to the user
- [ ] Log all save/load failures with file path and error details

## Files to Touch

- `src/main/store/conversations.ts` — atomic write, backup rotation, recovery

## Tests

- Unit: atomic write via temp file + rename
- Unit: backup file created on each save
- Unit: corrupted primary loads from backup
- Unit: both corrupt surfaces clear error

## Review Notes (2026-03-06, spec/code audit)

- Conversation saves already go through `atomicWriteJSON()` in `src/main/store/conversations.ts`, so the repository has the atomic-write foundation this spec asked for.
- Backup rotation, backup restore on load failure, and user-facing recovery messaging are still missing, so the data-loss mitigation is only partially complete.
