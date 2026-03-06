# Fix Audit Findings Regressions

**Status:** Completed
**Priority:** P1
**Severity:** Reliability
**Depends on:** `tasks/specs/parallel-audit-report.md`
**Origin:** User request on 2026-03-06

---

## Goal

Fix the concrete audit findings by adding regression coverage first, then implementing the behavior changes safely:

- preserve orchestration resume concurrency semantics
- surface and handle Waggle settings failures in the renderer
- avoid silent attachment extraction degradation
- close the highest-signal test gaps called out in the audit

## Checklist

- [x] Add regression tests for orchestration resume parallelism
- [x] Add direct unit coverage for `src/main/orchestration/service/model-runner.ts`
- [x] Add direct unit coverage for `src/main/mcp/mcp-client.ts`
- [x] Add direct unit coverage for `src/main/sub-agents/worktree-manager.ts`
- [x] Add Waggle settings failure-path component coverage
- [x] Add attachment extraction failure-path integration coverage
- [x] Implement orchestration resume fix
- [x] Implement Waggle settings error handling and user feedback
- [x] Implement attachment extraction diagnostics/fallback behavior
- [x] Run required verification (`pnpm test`, `pnpm check`, React Doctor if renderer changed)
- [x] Update this spec with review notes and final outcomes

## Review Notes

- Added direct regression coverage for all audit-referenced gaps:
  - orchestration resume preserves `maxParallelTasks`
  - new unit suites for `model-runner`, `mcp-client`, and `worktree-manager`
  - Waggle settings component failure states
  - attachment extractor failure diagnostics for PDF, image OCR, DOCX, and ODT
- Persisted orchestration checkpoints now round-trip `maxParallelTasks` through engine snapshots, shared schemas, and repository mappings so resumed runs keep their original concurrency cap.
- Waggle settings actions now surface inline renderer errors for load/save/create/delete failures instead of failing silently or leaving unhandled rejections.
- Attachment extraction now logs extractor-specific warnings and degrades to empty extracted text without hiding the failure from diagnostics.
- Verification completed:
  - `pnpm test`
  - `pnpm check`
  - `npx -y react-doctor@latest . --verbose --diff main` → `100 / 100`

