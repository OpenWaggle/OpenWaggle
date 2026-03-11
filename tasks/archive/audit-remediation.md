# Audit Remediation

**Status:** Done
**Priority:** P1
**Severity:** Engineering
**Depends on:** `tasks/specs/parallel-audit-report.md`
**Origin:** User request on 2026-03-06

---

## Goal

Amend the audit findings with a tests-first implementation pass that improves:
- architecture hotspots
- regression coverage
- error handling visibility
- developer ergonomics

Constraints:
- follow SRP / DRY
- preserve strong runtime + compile-time type safety
- avoid compatibility scaffolding unless needed

## Checklist

- [x] Add direct regression tests for `runAgent`
- [x] Add direct regression tests for `runWaggleSequential`
- [x] Add behavioral tests for `useChatPanelSections`
- [x] Add component tests for `WaggleSection`
- [x] Extend queue / steer error-path tests before changing behavior
- [x] Refactor preload API wiring to reduce duplication and drift risk
- [x] Extract project-config trust behavior into focused modules/helpers
- [x] Extract chat approval/error-handling behavior out of the large controller hook
- [x] Replace silent renderer failure paths with structured logs + user feedback
- [x] Add lighter-weight DX scripts/docs for fast local validation loops
- [x] Run targeted tests, `pnpm check`, and React Doctor
- [x] Record review notes and any significant learnings

## Review Notes

- Added direct unit coverage for `runAgent` and `runWaggleSequential`, plus new renderer component coverage for queued-send failures, `useChatPanelSections`, and `WaggleSection`.
- Refactored queued-message failure feedback into a focused renderer helper and added `onSendFailure` support to `useAutoSendQueue` so retries remain visible to both users and logs.
- Extracted trust-pattern parsing/matching helpers from `project-config.ts`, reducing config-file orchestration code and trust evaluation code mixing in the same module.
- Replaced preload event boilerplate with typed `invoke`/`send`/`on` factories derived from the shared IPC channel maps.
- Added logger stderr fallback coverage so file-logger init/append failures are surfaced instead of disappearing silently.
- Added lighter-weight local verification scripts in `package.json` and documented them in `AGENTS.md`.
- Follow-up controller coverage raised `use-chat-panel-controller.ts` to 94.19% line coverage / 79.04% branch coverage in the component coverage run, with new tests around waggle lifecycle, approval trust flows, and skill insertion behavior.
- Review follow-up fixes pinned async queue send-failure reporting to the originating conversation render and kept file logging disabled after failed logger initialization so one-time init failures do not degrade into repeated stderr noise.
- Verification completed with `pnpm test`, `pnpm check`, and `npx -y react-doctor@latest . --verbose --diff main` (score: 100/100, no issues).
