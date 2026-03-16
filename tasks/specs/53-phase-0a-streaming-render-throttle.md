# 53 Phase 0A — Streaming Render Throttle

**Status:** Implemented
**Priority:** P0
**Category:** Performance
**Branch:** `feat/spec-53-streaming-perf` (sandbox blocked creating a new branch for this worktree)
**Scope:** `StreamingText` renderer throttling only

## Goal

Reduce `StreamingText` re-renders during active streaming by batching visible text updates behind `requestAnimationFrame`, while preserving immediate rendering when not streaming and on the final stream flush.

## Plan

- [x] Add `src/renderer/src/hooks/useThrottledStreamText.ts`
- [x] Update `src/renderer/src/components/chat/StreamingText.tsx` to accept `isStreaming?: boolean`
- [x] Add tests for immediate rendering, rAF batching, and final flush behavior
- [x] Run `pnpm check:fast`
- [x] Run `pnpm test:unit:raw`
- [ ] Run React Doctor diagnostics because renderer code changed
- [x] Attempt the requested commit and completion event

## Constraints

- No type casts.
- Do not touch waggle files, IPC connection adapters, or unrelated rendering paths.
- Keep the change isolated to streaming text rendering and its tests.

## Review

- Implemented `requestAnimationFrame`-gated streaming text batching via `useThrottledStreamText`.
- Wired `StreamingText` call sites so assistant text and streaming plan text actually opt into throttling.
- `pnpm check:fast` passed.
- `pnpm vitest run -c vitest.component.config.ts src/renderer/src/components/chat/__tests__/StreamingText.component.test.tsx` passed.
- `pnpm test:unit:raw` still fails for pre-existing environment issues unrelated to this change:
  - OAuth callback server tests cannot bind `127.0.0.1` in the sandbox (`listen EPERM`).
  - Several main-process tests fail because `better-sqlite3` is built for a different Node ABI (`NODE_MODULE_VERSION 143` vs required `137`).
- React Doctor could not be completed in this environment:
  - `pnpm exec react-doctor --help` reports the binary is not installed locally.
  - `npx -y react-doctor@latest . --verbose --diff main` hung during package bootstrap/fetch, which is consistent with restricted network access.
- Requested git/event attempts were made but could not complete in this environment:
  - `git add` / `git commit` failed because the sandbox cannot write the shared worktree git metadata under `/Users/diego.garciabrisa/Desktop/Projects/OpenWaggle/.git/...`.
  - `openclaw system event ...` failed with `gateway closed (1006 abnormal closure)` against `ws://127.0.0.1:18789`.
