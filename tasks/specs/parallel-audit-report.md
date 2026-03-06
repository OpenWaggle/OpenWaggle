# Parallel Audit Report

**Status:** Completed
**Priority:** P2
**Severity:** Engineering
**Depends on:** None
**Origin:** User request on 2026-03-06

---

## Goal

Produce a concise repository audit across five lenses:
- architecture hotspots
- test gaps
- error handling risks
- DX pain points
- quick wins

## Checklist

- [x] Review required project context and note relevant warnings/preferences
- [x] Inspect the codebase in parallel across the five requested lenses
- [x] Capture evidence-backed findings with concrete file references
- [x] Summarize the highest-signal findings in a concise final report
- [x] Add review notes and any significant technical learnings if warranted

## Review Notes

- Architecture hotspots:
  - `src/main/config/project-config.ts` concentrates config IO, TOML parsing, cache invalidation, git exclude mutation, trust matching, and approval recording in one module.
  - `src/preload/api.ts` + `src/shared/types/ipc.ts` + `src/preload/api.unit.test.ts` represent the same IPC surface in three places, increasing contract-drift cost.
  - `src/renderer/src/components/chat/use-chat-panel-controller.ts` acts as a large orchestration hook that wires many stores/hooks and owns approval, waggle, queue, and diff behaviors.
- Test gaps:
  - No direct tests for `src/main/agent/agent-loop.ts` or `src/main/agent/waggle-coordinator.ts`; current coverage is mostly downstream handler mocking and submodule tests.
  - `src/renderer/src/components/chat/use-chat-panel-controller.unit.test.ts` only exercises `resolvePendingApprovalForUI`, so the actual `useChatPanelSections()` hook remains effectively uncovered.
  - `src/renderer/src/components/settings/sections/WaggleSection.tsx` has no matching test coverage.
- Error handling risks:
  - `src/renderer/src/hooks/useAutoSendQueue.ts` re-enqueues failed sends without logging or user feedback.
  - `src/renderer/src/components/chat/use-chat-panel-controller.ts` swallows steer/send failures after re-enqueue.
  - `src/main/logger.ts` silently ignores file logger init and append failures, reducing diagnosability when logs are needed most.
- DX pain points:
  - Local feedback loops are heavy: `pnpm check` chains multiple custom gates and `pnpm test:e2e:headless` always rebuilds before Playwright.
  - `pnpm dev` only hot-reloads the renderer; main-process edits require restart.
- Quick wins:
  - Extract or generate preload IPC wrappers from the channel maps.
  - Add direct tests for `runAgent`, `runWaggleSequential`, and `useChatPanelSections`.
  - Replace silent catches in renderer user paths with structured logs and lightweight user-visible errors.
