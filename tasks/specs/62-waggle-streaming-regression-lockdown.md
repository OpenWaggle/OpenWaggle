# 62) Waggle Streaming Regression Lockdown

Status: Completed  
Owner: Codex  
Date: 2026-03-20

## Goal

Lock down Waggle streaming rendering behavior with deterministic automated coverage so turn-label drift, user-message disappearance, and approval-surface regressions are caught before release.

## PRD Alignment

- Scope aligns with regression hardening for existing Waggle behavior (no new HC-UI feature).
- No PRD behavior change required in `docs/product/ui-interaction-prd.md`.

## Checklist

- [x] Confirm current regression fixes remain green (`pnpm check:fast`, targeted suites).
- [x] Add deterministic Waggle transcript E2E fixture and assertion matrix:
  - [x] User prompt persists in transcript.
  - [x] Turn divider sequence stays clean (`Turn 1` … `Turn 5`) with no inflated numbering.
  - [x] Turn content remains aligned with divider labels.
  - [x] No stale approval controls on completed Waggle transcript fixture.
- [x] Extend renderer hook coverage for live metadata mapping robustness.
- [x] Run targeted tests for touched files.
- [x] Run `pnpm check:fast`.
- [x] Run React Doctor diagnostics and confirm no regression.
- [x] Capture technical learnings in `tasks/learnings.md` if new high-signal findings emerge.

## Review Notes

### Implemented

- Added deterministic Waggle transcript fixture and E2E regression:
  - `e2e/support/waggle-regression-fixtures.ts`
  - `e2e/waggle-streaming-rendering.e2e.test.ts`
- Extended E2E seed helper to persist optional `waggleConfig`:
  - `e2e/support/conversation-fixtures.ts`
- Added renderer hook regression coverage for multi-message live metadata mapping:
  - `src/renderer/src/hooks/__tests__/useWaggleMetadataLookup.component.test.tsx`
- Hardened post-run suppression so only ghost reconnects are swallowed while explicit user sends always pass:
  - `src/renderer/src/lib/ipc-connection-adapter.ts`
  - `src/renderer/src/lib/__tests__/ipc-connection-adapter.unit.test.ts`
- Hardened synthesis reliability by retrying with Agent A model when default synthesis model fails, and propagating final synthesis failure reason:
  - `src/main/agent/waggle-coordinator.ts`
  - `src/main/agent/__tests__/waggle-coordinator.unit.test.ts`
- Reduced log noise in hot paths after regression triage:
  - Demoted per-tool lifecycle logs to debug (`src/main/agent/feature-registry.ts`)
  - Demoted orchestration per-tool executor logs to debug (`src/main/orchestration/service/model-runner.ts`)
  - Removed expected-parse-failure warnings from persisted tool-call reconciliation (`src/renderer/src/lib/persisted-tool-call-reconciliation.ts`)

### Verification

- `pnpm test:component -- src/renderer/src/hooks/__tests__/useWaggleMetadataLookup.component.test.tsx src/renderer/src/components/chat/__tests__/useChatScrollBehaviour.component.test.tsx src/renderer/src/components/chat/__tests__/ChatTranscript.wiring.component.test.tsx` ✅
- `pnpm test:e2e:headless:quick -- e2e/waggle-streaming-rendering.e2e.test.ts` ✅
- `pnpm test:unit -- src/main/ipc/__tests__/waggle-handler.unit.test.ts src/main/agent/__tests__/waggle-coordinator.unit.test.ts src/main/tools/__tests__/define-tool.unit.test.ts` ✅
- `pnpm test:unit -- src/renderer/src/lib/__tests__/persisted-tool-call-reconciliation.unit.test.ts src/renderer/src/lib/__tests__/ipc-connection-adapter.unit.test.ts src/main/agent/__tests__/waggle-coordinator.unit.test.ts` ✅
- `pnpm check:fast` ✅
- `pnpm dlx react-doctor@latest . --verbose --diff main` ✅ (100/100)
