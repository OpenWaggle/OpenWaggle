# TanStack AI Upgrade + Patch Reduction

## Goal

Upgrade all `@tanstack/ai*` runtime packages to the latest compatible versions, then reduce local pnpm patching to only behavior that is still not fixed upstream.

## Plan

- [x] Confirm current and latest `@tanstack/ai*` versions and patch coverage.
- [x] Upgrade `@tanstack/ai` and provider packages in `package.json`.
- [x] Reinstall/update lockfile and ensure patched dependency key targets the new version.
- [x] Diff upstream `0.6.1` behavior vs local patch and remove now-upstream hunks.
- [x] Run focused tests for streaming/approval behavior and type checks.
- [x] Summarize what remains local and draft maintainer-report notes.

## Verification

- [x] `pnpm typecheck:node`
- [x] `pnpm vitest run -c vitest.unit.config.ts src/main/agent/stream-part-collector.unit.test.ts src/main/agent/system-prompt.unit.test.ts src/renderer/src/lib/ipc-connection-adapter.unit.test.ts src/renderer/src/lib/ipc-connection-adapter.extra.unit.test.ts`
- [x] `pnpm check`
- [x] `pnpm test`
- [x] `npx -y react-doctor@latest . --verbose --diff main`

## Review Notes

- Upgraded runtime packages:
  - `@tanstack/ai` `0.5.0` -> `0.6.1`
  - `@tanstack/ai-anthropic` `0.5.0` -> `0.6.0`
  - `@tanstack/ai-gemini` `0.5.0` -> `0.7.0`
  - `@tanstack/ai-grok` `0.5.0` -> `0.6.0`
  - `@tanstack/ai-ollama` `0.5.0` -> `0.6.0`
  - `@tanstack/ai-openai` `0.5.0` -> `0.6.0`
  - `@tanstack/ai-openrouter` `0.5.0` -> `0.6.1`
  - `@tanstack/ai-react` `0.5.3` -> `0.6.1`
- Reduced patch surface:
  - Removed old `patches/@tanstack__ai@0.5.0.patch`.
  - New patch `patches/@tanstack__ai@0.6.1.patch` modifies:
    - `src/activities/chat/tools/tool-calls.ts` (approval-first batch gating)
    - `src/activities/chat/stream/message-updaters.ts` (preserve existing `tool-call` approval/output fields during updates)
  - Upstream already includes early `tool-result` emission before approval/client-exec wait, so local patch keeps only approval-first execution gating for mixed tool batches.
- Follow-up compatibility adjustment:
  - Updated `src/main/agent/stream-part-collector.unit.test.ts` helper to use `CustomEvent.value` (new TanStack type shape) instead of `data`.
- Additional validation:
  - Full repository checks are now green (`pnpm check`, `pnpm test`, React Doctor 100/100).
