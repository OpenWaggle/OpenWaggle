# 53 TanStack Known Issues Regression Matrix

## Goal
Strengthen automated coverage for documented TanStack AI limitations so we can:
- prevent OpenWaggle behavior regressions, and
- detect when upstream TanStack behavior changes (potentially allowing workaround removal).

## Scope
1. Map `docs/tanstack-ai-known-issues.md` issues to concrete tests.
2. Add deterministic continuation-stream probes for chunk lifecycle behavior.
3. Add sentinel probes for upstream-fix detection where deterministic reproduction is possible.
4. Document the regression/sentinel matrix and execution guidance.

## Test-First Plan
- [x] Add TanStack continuation harness tests that capture chunk sequences from `chat(...)`.
- [x] Add sentinel probe test(s) for upstream behavior-change detection.
- [x] Add/extend OpenWaggle regression tests tied to documented workaround paths.

## Implementation Plan
- [x] Add a dedicated `tanstack-known-issues` test module under agent tests.
- [x] Wire deterministic mock adapter + tool fixture for continuation execution.
- [x] Add test docs mapping each issue to test(s) and interpretation rules.

## Verification Plan
- [x] Run targeted tests for the new module(s).
- [x] Run `pnpm test`.
- [x] Run `pnpm check`.
- [x] Run `pnpm test:e2e`.
- [x] Run React Doctor (`npx -y react-doctor@latest . --verbose --diff main`) because renderer files changed.

## Review Notes
- Added deterministic TanStack continuation probe coverage:
  - `src/main/agent/tanstack-known-issues.unit.test.ts`
  - Includes an upstream sentinel asserting current end-only continuation chunk behavior (`TOOL_CALL_END` without `TOOL_CALL_START` / `TOOL_CALL_ARGS`).
- Added renderer-side idle-wait regression coverage for continuation approval timing:
  - `src/renderer/src/components/chat/wait-for-not-loading.unit.test.ts`
  - `src/renderer/src/components/chat/wait-for-not-loading.ts`
  - `src/renderer/src/components/chat/use-chat-panel-controller.ts` now delegates idle waiting to the tested utility.
- Added matrix command for fast re-runs:
  - `pnpm test:tanstack-known-issues`
- Updated issue documentation with matrix + upstream-fix interpretation guidance:
  - `docs/tanstack-ai-known-issues.md`
- Verification results:
  - `pnpm test:tanstack-known-issues` ✅
  - `pnpm check` ✅
  - `pnpm test` ✅
  - `pnpm test:e2e` ✅ (5/5)
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (`100 / 100`)
