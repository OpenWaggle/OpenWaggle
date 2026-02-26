# Spec: Backend-Driven Phase Labels Across Modes

## Context
- Goal: move phase-label logic to backend so renderer only renders provided phase state.
- Must work in single-agent, orchestration, and waggle (waggle) modes.
- Preserve existing labels: Thinking, Writing, Planning, Reviewing, Researching, Debugging, Refactoring, Testing, Documenting, Editing, Executing.

## Plan
- [x] Add shared phase type + IPC event channel for backend phase updates.
- [x] Implement main-process phase tracker driven by stream chunks + orchestration events.
- [x] Wire phase tracker emissions in stream bridge and clear on cancel paths.
- [x] Expose phase subscription in preload/renderer API.
- [x] Update renderer to consume backend phase and remove FE label-derivation logic.
- [x] Update tests and run verification (typecheck, targeted tests, lint, react-doctor).

## Review
- Added backend-driven phase contract (`AgentPhaseState`) and IPC event channel `agent:phase`.
- Implemented a main-process phase tracker that:
  - derives single-agent/waggle phases from stream chunks (`RUN_STARTED` -> `Thinking`, first text -> `Writing`, terminal -> clear),
  - derives orchestration phases from orchestration lifecycle events and task kinds (`Planning`, kind-based active phases, `Reviewing`, `Writing`).
- Stream bridge now emits `agent:phase` updates and clears phase state on cancel paths.
- Renderer now subscribes to backend phase via `useAgentPhase` and `ChatPanel` renders phase timelines from backend-provided state; FE label derivation logic was removed.
- Verification:
  - `pnpm typecheck` ✅
  - `pnpm test:unit -- src/main/agent/phase-tracker.unit.test.ts src/renderer/src/hooks/useStreamingPhase.unit.test.ts src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx` ✅
  - `pnpm test:integration -- src/main/store/conversations.integration.test.ts` ✅
  - `pnpm lint` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (`99/100`, 1 warning: `App.tsx` size)
