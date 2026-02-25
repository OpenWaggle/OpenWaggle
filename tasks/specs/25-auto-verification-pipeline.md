# 25 — Auto-Verification Pipeline

**Status:** Planned
**Priority:** P2
**Category:** Feature
**Depends on:** None
**Origin:** Spec 18

---

## Goal

The agent automatically verifies its own work after every code change — typecheck, lint, tests — and self-corrects before presenting to the user. If the agent says "done," the code compiles and the tests pass.

---

## The Problem

Every coding agent today has the same failure mode:

1. Agent writes code
2. Agent says "Done!"
3. User runs the app — it doesn't compile
4. User tells the agent it's broken
5. Agent tries to fix it, often making it worse
6. Agent edits test files to make failing tests pass instead of fixing the actual bug
7. User reverts everything and starts over

The root cause: **agents don't verify their own output.**

---

## Architecture

### Verification Pipeline

After every code-modifying tool call (`writeFile`, `editFile`), the pipeline runs automatically:

```
Agent writes/edits code
  → Debounce (wait 500ms for batch of related edits)
  → Stage 1: Typecheck (pnpm typecheck or equivalent)
  → Stage 2: Lint (pnpm lint or equivalent)
  → Stage 3: Affected tests (run tests for modified files only)
  → Results fed back to agent context
  → If all green: agent continues normally
  → If failures:
    → Agent sees errors + original intent
    → Agent gets ONE self-correction attempt
    → If still failing after correction: present to user with error context
```

### Key Design Principles

1. **Automatic, not opt-in.** The pipeline runs by default.
2. **Fast feedback.** Only run checks relevant to what changed.
3. **Self-correction with guardrails.** Agent gets one chance to fix failures.
4. **Never modify tests to pass.** Explicit rule in the self-correction prompt.
5. **Transparent.** User sees verification status in real-time.

### Git Checkpoint Integration

Before the agent makes any changes, create a lightweight checkpoint:

```
Agent turn starts
  → git stash create → checkpoint saved
  → Agent makes changes
  → Verification pipeline runs
  → If all green: discard checkpoint
  → If user wants to undo: restore checkpoint
```

---

## Implementation

### Phase 1: Verification Runner

- [ ] Create `src/main/agent/verification-runner.ts`
  - `runVerification(changes, projectPath): VerificationResult`
  - Detects project type from config files
  - Runs checks in order: typecheck → lint → tests
  - Short-circuits: if typecheck fails, skip lint and tests
  - Timeout: 30 seconds per stage (configurable)

- [ ] Create `src/main/agent/affected-tests.ts`
  - Given changed files, determine which tests to run
  - Convention-based (`src/foo.ts` → `src/foo.test.ts`)
  - Fallback: run all tests in same directory

### Phase 2: Agent Loop Integration

- [ ] Hook verification into agent loop after tool execution
- [ ] Self-correction prompt rules:
  - "Fix the source code to resolve these errors."
  - "Do NOT modify test files to make tests pass."
  - "Do NOT ignore type errors with `as any` or `@ts-ignore`."
- [ ] Self-correction loop cap: max 1 attempt per failure

### Phase 3: Git Checkpoints

- [ ] Create `src/main/agent/checkpoint-manager.ts`
  - `createCheckpoint(conversationId, turnIndex)`
  - `restoreCheckpoint(checkpointId)`
  - `discardCheckpoint(checkpointId)`
- [ ] Add "Undo Turn" button in UI
- [ ] Add "Undo All" button

### Phase 4: Verification UI

- [ ] Real-time verification status in chat
- [ ] Verification badge on completed turns (green/yellow/red)
- [ ] Undo button placement next to each agent turn

### Phase 5: Configuration

- [ ] Project-level verification config (`.openwaggle/verification.json`)
- [ ] Auto-detect if no config exists
- [ ] Settings panel toggle for enable/disable
- [ ] Per-conversation override for prototyping

---

## Performance Budget

| Stage | Expected Duration |
|-------|------------------|
| Typecheck | 2-10s |
| Lint | 1-5s |
| Affected tests | 2-30s |
| **Total** | **5-45s** |

Pipeline runs in parallel with the agent's next thought.

---

## Files to Create

- `src/main/agent/verification-runner.ts`
- `src/main/agent/affected-tests.ts`
- `src/main/agent/checkpoint-manager.ts`
- `src/renderer/src/components/chat/VerificationStatus.tsx`
- `src/renderer/src/components/chat/UndoButton.tsx`

## Files to Modify

- `src/main/agent/agent-loop.ts` — hook verification after tool calls
- `src/main/tools/tools/write-file.ts` — trigger verification
- `src/main/tools/tools/edit-file.ts` — trigger verification
- `src/shared/types/ipc.ts` — verification status + undo IPC channels
- `src/renderer/src/components/chat/MessageBubble.tsx` — verification badges + undo

## Verification

- [ ] Agent writes code with a type error → pipeline catches it → agent self-corrects
- [ ] Agent writes code that fails a test → agent fixes source code, NOT the test
- [ ] Self-correction cap: agent fails twice → presents error to user
- [ ] Undo button reverts all files from last agent turn
- [ ] Pipeline auto-detects typecheck/lint/test commands from project config
- [ ] Verification status shows in real-time in chat UI
