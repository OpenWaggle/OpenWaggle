# 06 — Orchestration Executor Permissions + Default Permissions Clarity

**Status:** Completed (2026-03-04)  
**Priority:** P1  
**Severity:** High  
**Depends on:** None  
**Origin:** Spec 02 follow-up + executor runtime audit

---

## Summary

Complete executor permissions on the active orchestration path, remove dead orchestration path code, keep team/sub-agent behavior intact, and make permission semantics explicit:

- `Default permissions` means approval-gated tool execution on host runtime.
- `Full access` means no tool approvals.
- Do not claim command/runtime OS sandboxing when none exists.

## Current Audit (Literal)

- Active orchestration runtime path is the `orchestrate` tool:
  - `src/main/tools/tools/orchestrate.ts`
- Current executor toolset is read-only:
  - `src/main/orchestration/project-context.ts#createExecutorTools` (`readFile`, `glob`, `webFetch`)
- Legacy orchestrated runner path appears non-runtime (tests/exports only):
  - `src/main/orchestration/service.ts`
  - `src/main/orchestration/service/runner.ts`
- Existing approval persistence is narrow:
  - `writeFile` trust only in `.openwaggle/config.local.toml`
  - `src/main/config/project-config.ts`
- UI/docs still contain wording that implies command sandboxing in places.

## Locked Decisions

1. Keep the team feature and agent-type permission model.
2. Support only the active orchestration path; remove dead runtime path code.
3. Adopt Codex-style policy intent:
   - default mode requires approvals
   - remembered approvals avoid repeated prompts
   - full access bypasses approvals
4. Remove legacy `sandbox` terminology from enum/storage keys and code paths (no backward-compat layer).
5. Explicitly document that command execution is host runtime, not OS/container sandboxing.
6. In `default-permissions`, `runCommand` approval is command-pattern-aware (not just tool-aware).
7. In `default-permissions`, `webFetch` approval is URL-pattern-aware (not just tool-aware).
8. Trust persistence for commands/URLs uses wildcard/pattern rules (no exact-match-only policy).

## Implementation Plan

- [x] **Phase 1 — Permission model baseline on active path**
  - Added active-path executor tool assembly in `src/main/orchestration/executor-tools.ts` with an explicit toolset (`readFile`, `glob`, `listFiles`, `writeFile`, `editFile`, `runCommand`, `webFetch`).
  - Kept synthesis task execution tool-less in `orchestrate` path.
  - Added default-permissions trust guard behavior for executor tool calls and full-access approval stripping.

- [x] **Phase 2 — Remove dead orchestration path**
  - Removed dead runtime path files:
    - `src/main/orchestration/service.ts`
    - `src/main/orchestration/service/runner.ts`
    - `src/main/orchestration/service.unit.test.ts`
    - `src/main/orchestration/service/runner.orchestration.unit.test.ts`
  - Active runtime path remains `src/main/tools/tools/orchestrate.ts`.

- [x] **Phase 3 — Approval persistence generalization**
  - Extended local trust schema to include all trustable tools.
  - Added command-pattern trust persistence (`runCommand`) and URL-pattern trust persistence (`webFetch`) in `project-config`.
  - Added trust checks + trust recording IPC channels and renderer wiring.
  - Continued `.openwaggle/config.local.toml` git-exclude enforcement.

- [x] **Phase 4 — Full access behavior**
  - Added agent feature-level full-access approval bypass (`withoutApproval`).
  - Added trusted-tool approval stripping for write/edit in default-permissions.
  - Added renderer auto-approval reuse for trusted tool calls (command/url-aware in default-permissions).

- [x] **Phase 5 — Terminology + safety documentation**
  - Renamed execution mode key from `sandbox` to `default-permissions` across shared types, settings, IPC validation, renderer controls, prompts, and tests.
  - Updated docs and UI text to avoid claiming command runtime sandboxing.
  - Kept user-facing labels `Default permissions` / `Full access`.

- [x] **Phase 6 — Tests and verification**
  - Added/updated unit tests for trust persistence and matching rules:
    - `src/main/config/project-config.unit.test.ts`
    - `src/main/orchestration/executor-tools.unit.test.ts`
  - Updated affected unit tests for execution-mode rename and feature behavior.
  - Verified with:
    - `pnpm test:unit`
    - `pnpm test:e2e:headless`
    - `pnpm check`
    - `pnpm prepush:main`

## Review Notes

- Default-permissions now means approval-gated host runtime execution with trust reuse (not OS/container sandboxing).
- Trust policy is pattern-based for `runCommand` and `webFetch` and persists in `.openwaggle/config.local.toml`.
- Full-access now strips approval requirements in both agent and active orchestration executor paths.
- Dead orchestration runner/export path was removed to keep runtime ownership on the active `orchestrate` path.

## Files Expected To Change

- `src/main/tools/tools/orchestrate.ts`
- `src/main/orchestration/project-context.ts` (if retained helpers are still needed)
- `src/main/orchestration/service.ts` (remove dead export path if unused)
- `src/main/orchestration/service/runner.ts` (remove if confirmed dead)
- `src/main/agent/feature-registry.ts`
- `src/main/agent/agent-loop.ts`
- `src/main/config/project-config.ts`
- `src/shared/schemas/validation.ts`
- `src/shared/types/settings.ts`
- `src/main/ipc/project-handler.ts`
- `src/main/ipc/settings-handler.ts`
- `src/main/store/settings.ts`
- `src/renderer/src/components/composer/ActionDialog.tsx`
- `src/renderer/src/components/composer/ComposerStatusBar.tsx`
- `src/renderer/src/stores/preferences-store.ts`
- `src/main/agent/system-prompt.ts`
- `src/main/tools/tools/run-command.ts`
- `src/main/tools/tools/web-fetch.ts`
- `docs/user-guide/configuration.md`
- `docs/user-guide/chat-and-tools.md`
- `docs/agent-extensibility.md`
- `docs/product/ui-interaction-prd.md` (terminology/behavior correction)

## Verification

1. `pnpm test:unit`
2. `pnpm test:e2e:headless`
3. `pnpm check`
4. `pnpm prepush:main`

## Risks and Mitigations

- **Risk:** Nested executor approvals can deadlock if approval flow is not fully bridged.
  - **Mitigation:** Gate executor tool exposure by effective trust in default mode until approval bridging is validated, and add deterministic fallback error text.
- **Risk:** Renaming execution mode keys causes stale local settings in existing dev environments.
  - **Mitigation:** Since we are intentionally pre-user and non-backward-compatible, perform a hard rename and update fixtures/tests in-repo; document that local dev settings may reset.
- **Risk:** Over-broad executor tools allow recursive orchestration loops.
  - **Mitigation:** Strict denylist for meta/team/orchestration control tools with explicit tests.
