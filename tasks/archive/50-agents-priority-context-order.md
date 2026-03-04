# 50 — AGENTS.md Priority in Project Context

**Status:** Done
**Priority:** P2
**Severity:** Medium
**Category:** Fix
**Depends on:** None
**Origin:** User report (Anthropic context ordering)

---

## Problem

`src/main/orchestration/project-context.ts` listed `CLAUDE.md` before `AGENTS.md` in key-file context assembly. This caused some model/provider runs to see provider-specific guidance ahead of project-standard `AGENTS.md` rules.

This task aligns with `docs/product/ui-interaction-prd.md` HC-UI-015 intent that AGENTS remains the baseline instruction source.

## Implementation

### Phase 1: Ordering fix
- [x] Update key-file ordering to keep README/config context first while prioritizing `AGENTS.md` before `CLAUDE.md`.
- [x] Keep the change isolated to orchestration project-context assembly.

### Phase 2: Tests
- [x] Add deterministic unit coverage for key-file ordering in `project-context.unit.test.ts`.

## Tests

- Unit: `pnpm test:unit -- src/main/orchestration/project-context.unit.test.ts`

## Review

- Updated `src/main/orchestration/project-context.ts` ordering to: README -> package summary -> AGENTS -> CLAUDE.
- Added unit regression coverage in `src/main/orchestration/project-context.unit.test.ts`.
- Verified with `pnpm test:unit -- src/main/orchestration/project-context.unit.test.ts` (pass).
