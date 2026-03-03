# Pre-push main Quality Gates

**Status:** In Progress
**Priority:** P2
**Severity:** High
**Category:** Fix
**Depends on:** None
**Origin:** User request (2026-03-03)

---

## Problem

The repository does not currently have Husky hooks configured, so pushes can reach `main` without running the local quality gates. We need a `pre-push` hook that runs `pnpm check`, `pnpm format`, and all tests when pushing `main`, while ensuring e2e tests run headless.

PRD alignment: this task does not map to any planned/future `HC-UI-*` feature in `docs/product/ui-interaction-prd.md`; it is a developer workflow safeguard.

## Implementation

### Phase 1: Hook wiring
- [x] Add Husky setup to repository scripts/dependencies.
- [x] Add a `pre-push` hook that detects whether `refs/heads/main` is being pushed.
- [x] Ensure non-main pushes skip quality-gate execution.

### Phase 2: Quality command flow
- [x] Create a script that runs `pnpm check`, `pnpm format`, unit/component/integration tests, and headless e2e tests.
- [x] Point the hook to that script and fail push on any command failure.

### Phase 3: Documentation + verification
- [x] Update developer documentation for the new pre-push behavior.
- [x] Validate the hook behavior for both non-main and main push refs.

## Tests

- Manual: simulate pre-push stdin for a non-main push and verify it skips.
- Manual: simulate pre-push stdin for `main` and verify it runs quality commands.

## Review

- Added Husky setup (`prepare` script + `husky` dev dependency) and a new `.husky/pre-push` hook.
- Hook now runs `pnpm prepush:main` only when remote target includes `refs/heads/main`; non-main pushes skip.
- Added `prepush:main`, `test:all`, and `test:e2e:headless` scripts in `package.json`.
- Updated docs in `README.md` and `docs/user-guide/developer-guide.md`.
- Verification:
  - Non-main simulation skipped correctly.
  - Main simulation executed gates and blocked on existing failing unit test:
    - `src/preload/api.unit.test.ts` → expected method list mismatch (`prepareAttachmentFromText`, `onPrepareAttachmentFromTextProgress` extra in runtime API).
