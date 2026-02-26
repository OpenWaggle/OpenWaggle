---
name: memory-safe-attachment-hydration
description: Keep Electron memory usage stable by separating renderer-safe attachment metadata from main-process binary hydration, and by preferring lightweight conversation summary indexing over full-history parsing. Use when attachment payloads or conversation lists are causing high memory pressure.
---

# Memory Safe Attachment Hydration

## Overview

Apply a memory-safe contract across Electron process boundaries:
- Renderer stores metadata-only attachments.
- Main process hydrates binary payloads just-in-time for provider calls.
- Conversation listing reads lightweight summaries instead of full message history.

## Workflow

1. Split attachment contracts in shared types.
- Define renderer-safe `PreparedAttachment` with no `source`.
- Define main-runtime `HydratedAttachment` (or equivalent) that includes binary `source`.
- Keep persisted message attachment parts metadata-only.

2. Keep `attachments:prepare` lightweight.
- Return only metadata and extracted text from preload/main IPC prepare handlers.
- Do not include base64 bytes in renderer state or long-lived stores.

3. Hydrate binary sources just-in-time in main.
- Right before `runAgent` and multi-agent execution, resolve file paths and read image/pdf bytes.
- Re-validate file size and existence during hydration.
- Fail fast with a user-visible error if attachments are no longer readable.

4. Optimize conversation listing with summary indexing.
- Store conversation summaries in an index file (for example `conversations/index.json`).
- Read index first for list views.
- Fall back to full scan only when missing or corrupt, then rebuild index.
- Keep index synced on create/save/delete updates.

5. Verify and guard.
- Run `pnpm typecheck` and `pnpm lint`.
- Run targeted tests for conversation store, attachment handler, and agent handlers.
- Confirm no direct renderer references to binary attachment `source` remain.

## Guardrails

- Do not persist binary attachment data in conversation JSON.
- Do not widen IPC payload types with `any`; use shared discriminated types.
- Do not parse full conversation histories for list-only views unless index recovery is required.
