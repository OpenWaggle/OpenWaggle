# Spec 51: Raise Test Coverage to >= 80%

## Baseline (2026-02-27)

| Metric     | Current | Target |
|------------|---------|--------|
| Statements | 57.32%  | >= 80% |
| Branches   | 49.28%  | >= 80% |
| Functions  | 50.09%  | >= 80% |
| Lines      | 59.16%  | >= 80% |

## Strategy

Focus on **high-impact, high-LOC, zero/low-coverage files** — prioritize files where the absolute number of uncovered lines is highest.

### Phase 1: Main Process Unit Tests (biggest LOC gains)
- [ ] `src/main/agent/agent-loop.ts` (318 uncovered lines)
- [ ] `src/main/tools/tools/` — glob, list-files, read-file, write-file, ask-user, run-command (300+ uncovered)
- [ ] `src/main/providers/` — gemini, grok, ollama, openrouter, anthropic (250+ uncovered)
- [ ] `src/main/ipc/` — handlers with 0% coverage (agent-handler, waggle-handler, settings, shell, terminal, git)
- [ ] `src/main/utils/` — stream-bridge, broadcast
- [ ] `src/main/tools/browser/` — browser tool implementations

### Phase 2: Preload Contract Tests
- [ ] `src/preload/api.ts` (409 uncovered lines) — validate API surface, method names, argument shapes

### Phase 3: Renderer Stores + Libs
- [ ] `src/renderer/src/stores/` — composer-store, waggle-store, review-store, git-store gaps
- [ ] `src/renderer/src/lib/` — cn, ipc, logger, agent-colors, git-mutation, tool-args
- [ ] `src/renderer/src/hooks/` — useAgentChat, useAgentPhase, useSettings, useSkills, etc.

### Phase 4: Renderer Component Tests
- [ ] High-LOC components: Composer, CommandPalette, Sidebar, Header, CommitDialog
- [ ] Lower-priority components for marginal gains

## Test Type Decisions
- **Unit (vitest, node env)**: all main process, preload, shared
- **Integration (vitest, node env)**: IPC handlers, store persistence
- **Component (vitest, jsdom)**: renderer components + hooks
- **E2E (playwright)**: critical user journeys

## Progress Tracking
After each batch, re-run coverage and record progress here.
