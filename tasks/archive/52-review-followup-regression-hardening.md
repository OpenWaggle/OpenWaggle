# 52 Review Follow-up Regression Hardening

## Goal
Fix all review findings from the current branch while preserving existing app behavior, with tests added before runtime fixes and full regression verification.

## Scope
1. Tighten trusted `runCommand` pattern matching to prevent shell-chain bypasses.
2. Fix lint/check blockers reported on the branch.
3. Prevent phase total-time corruption when a run starts without explicit phase reset.
4. Restrict transcript tool-call dedup so repeated commands across different user turns still render.

## Test-First Plan
- [x] Add/extend unit tests for trusted command matching (allow safe args, reject shell-chain suffix).
- [x] Add unit tests for streaming phase totals when no explicit reset is called.
- [x] Add unit tests for virtual-row tool-call dedup behavior across user turn boundaries.

## Implementation Plan
- [x] Patch `project-config` runCommand trust matcher to avoid unsafe wildcard matches.
- [x] Patch `useStreamingPhase` to initialize interaction timing safely when reset was not called.
- [x] Patch `useVirtualRows` dedup window to user-turn scope.
- [x] Fix remaining lint blockers in touched files without functional drift.

## Verification Plan
- [x] Run targeted unit tests for changed modules.
- [x] Run `pnpm lint`.
- [x] Run `pnpm check`.
- [x] Run `pnpm test`.
- [x] Run `pnpm test:e2e`.
- [x] If renderer touched, run React Doctor and ensure no new errors and score does not regress.

## Review Notes
- Added test-first coverage before runtime fixes:
  - `src/main/config/project-config.unit.test.ts`: rejects shell-chain suffixes in trusted `runCommand` patterns.
  - `src/renderer/src/hooks/useStreamingPhase.component.test.tsx`: validates correct `totalElapsedMs` bootstrap without explicit reset.
  - `src/renderer/src/components/chat/useVirtualRows.unit.test.ts`: verifies repeated tool calls across distinct user turns are retained.
- Runtime fixes:
  - Hardened `runCommand` trust matching in `src/main/config/project-config.ts` to block shell-chain operator abuse while preserving expected prefix/argument behavior.
  - Corrected phase timing bootstrap in `src/renderer/src/hooks/useStreamingPhase.ts`.
  - Scoped virtual-row tool-call dedup to per-user-turn in `src/renderer/src/components/chat/useVirtualRows.ts`.
  - Addressed lint/type blockers in `agent-loop`, `RunSummary`, and `use-chat-panel-controller`.
- Verification evidence:
  - `pnpm lint`: pass
  - `pnpm check`: pass
  - `pnpm test`: pass (unit/integration/component all green)
  - `pnpm test:e2e`: pass (5/5)
  - `npx -y react-doctor@latest . --verbose --diff main`: pass, score `100 / 100`
