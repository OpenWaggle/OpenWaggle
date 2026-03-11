# E2E Page Model Refactor

**Status:** Done
**Priority:** P2
**Severity:** Maintainability

## Goal
- Refactor current Playwright Electron E2E coverage to use shared page-model abstractions so new cases can be added without repeating launch, selector, and transcript setup code.

## Scope
- In scope:
  - Shared Electron app harness
  - Shared main-window/chat page model
  - Shared conversation-fixture helpers for seeded regression tests
  - Refactor current `e2e/*.e2e.test.ts` files to use the new abstractions
- Out of scope:
  - Adding broad new product behavior beyond existing E2E coverage

## Plan
- [x] Add shared E2E harness for launch/restart/cleanup with isolated user-data dirs
- [x] Add page-model helpers for common window/chat interactions
- [x] Move seeded conversation setup helpers out of raw spec files
- [x] Refactor existing E2E specs to the shared page-model structure
- [x] Verify Playwright E2E suite still passes

## Verification
- `pnpm exec playwright test e2e/app.e2e.test.ts e2e/security-csp.e2e.test.ts e2e/auto-attach.e2e.test.ts`
- `pnpm check:fast`
