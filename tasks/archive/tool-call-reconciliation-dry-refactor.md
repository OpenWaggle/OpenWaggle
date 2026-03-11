# Tool Call Reconciliation DRY Refactor

**Status:** Done
**Priority:** P2
**Severity:** Maintainability

## Goal
- Remove duplicated persisted tool-call reconciliation logic in the renderer so approval hydration and pending-approval detection share one source of truth.

## Scope
- In scope:
  - Shared renderer helper for persisted tool-call lookup and metadata restoration
  - Refactor `pending-tool-interactions.ts` and `useAgentChat.utils.ts` to use the shared helper
  - Update regression coverage for the shared path
- Out of scope:
  - Functional approval-flow changes beyond keeping existing behavior green

## Plan
- [x] Extract shared persisted tool-call reconciliation helpers
- [x] Refactor renderer consumers to use the shared module
- [x] Verify approval-focused unit tests, E2E, and React Doctor

## Verification
- `pnpm exec vitest run src/renderer/src/components/chat/pending-tool-interactions.unit.test.ts src/renderer/src/hooks/useAgentChat.utils.unit.test.ts`
- `pnpm exec playwright test e2e/auto-attach.e2e.test.ts`
- `pnpm check:fast`
- `npx -y react-doctor@latest . --verbose --diff main`
