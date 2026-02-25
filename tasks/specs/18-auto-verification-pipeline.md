# Spec 18 — Auto-Verification Pipeline

**Goal**: The agent automatically verifies its own work after every code change — typecheck, lint, tests — and self-corrects before presenting to the user. If the agent says "done," the code compiles and the tests pass. No more "it says it's done but nothing works."

**Status**: Planned

**Depends on**: None

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

The root cause: **agents don't verify their own output.** They generate code and move on. No typecheck, no lint, no test run. The user is the verification layer.

Worse: when agents *do* encounter failures (via user feedback), they compound mistakes. They fix symptoms instead of root causes. They modify tests to pass instead of fixing the code the tests are testing.

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

1. **Automatic, not opt-in.** The pipeline runs by default. Users can disable it, not enable it.
2. **Fast feedback.** Only run checks relevant to what changed. Don't run the full test suite on every edit.
3. **Self-correction with guardrails.** Agent gets one chance to fix failures. Not infinite loops.
4. **Never modify tests to pass.** Explicit rule in the self-correction prompt: "Fix the source code, not the tests. If a test fails, the test is probably right and your code is wrong."
5. **Transparent.** User sees verification status in real-time: "Typechecking... Linting... Running 3 tests... 2 passed, 1 failed → self-correcting..."

### Git Checkpoint Integration

Before the agent makes any changes, create a lightweight checkpoint:

```
Agent turn starts
  → git stash create (or lightweight ref) → checkpoint saved
  → Agent makes changes
  → Verification pipeline runs
  → If all green: discard checkpoint
  → If user wants to undo: restore checkpoint
```

This gives every agent turn a one-click "undo" without requiring the user to understand git.

---

## Implementation

### Phase 1: Verification Runner

- [ ] Create `src/main/agent/verification-runner.ts`
  - `runVerification(changes: FileChange[], projectPath: string): VerificationResult`
  - Detects project type from config files:
    - `tsconfig.json` → typecheck available
    - `biome.json` / `.eslintrc` → lint available
    - `vitest.config.*` / `jest.config.*` / `pytest.ini` → test runner available
    - `package.json` scripts → custom check/test commands
  - Runs checks in order: typecheck → lint → tests
  - Short-circuits: if typecheck fails, skip lint and tests (they'll fail too)
  - Timeout: 30 seconds per stage (configurable)
  - Returns structured result:
    ```
    {
      typecheck: { passed: boolean, errors: string[] },
      lint: { passed: boolean, errors: string[] },
      tests: { passed: boolean, failures: string[], testsRun: number },
      allPassed: boolean
    }
    ```

- [ ] Create `src/main/agent/affected-tests.ts`
  - Given a list of changed files, determine which tests to run
  - Strategy 1: Convention-based (`src/foo.ts` → `src/foo.test.ts`, `src/__tests__/foo.test.ts`)
  - Strategy 2: Import graph (if Spec 14 codebase indexing is available)
  - Strategy 3: Run all tests in the same directory as changed files
  - Fallback: if unsure, run all tests (with timeout)

### Phase 2: Agent Loop Integration

- [ ] Hook verification into agent loop after tool execution
  - After `writeFile` or `editFile` tool completes:
    - Debounce 500ms (agent often makes multiple edits in sequence)
    - Run verification pipeline
    - Inject results into agent context as a system message
  - Agent sees: "Verification: typecheck FAILED — 2 errors in src/main/foo.ts:42"
  - Agent is prompted to self-correct (one attempt)
- [ ] Self-correction prompt rules
  - "Fix the source code to resolve these errors."
  - "Do NOT modify test files to make tests pass."
  - "Do NOT ignore type errors with `as any` or `@ts-ignore`."
  - "If you cannot fix the error, explain why and present the issue to the user."
- [ ] Self-correction loop cap
  - Max 1 self-correction attempt per verification failure
  - If still failing: present to user with full error context + diff
  - Never silently retry more than once

### Phase 3: Git Checkpoints

- [ ] Create `src/main/agent/checkpoint-manager.ts`
  - `createCheckpoint(conversationId, turnIndex)` — `git stash create` or lightweight tag
  - `restoreCheckpoint(checkpointId)` — restore working tree to checkpoint state
  - `discardCheckpoint(checkpointId)` — cleanup (no-op for stash-create since it doesn't modify stash list)
  - Checkpoints are per-turn, not per-edit
  - Store checkpoint refs in memory (session-scoped, not persisted)
- [ ] Add "Undo Turn" button in UI
  - Appears after each agent turn that modified files
  - One click: restores all files to pre-turn state
  - Shows diff of what will be reverted before confirming
- [ ] Add "Undo All" button
  - Reverts all agent changes in the current session
  - Restores to state when conversation started

### Phase 4: Verification UI

- [ ] Real-time verification status in chat
  - Inline status after code blocks: "Verifying... ✓ Typecheck ✓ Lint ✓ Tests (3/3)"
  - Or: "Verifying... ✓ Typecheck ✗ Lint — 1 error → Self-correcting..."
  - Collapsible error details
- [ ] Verification badge on completed turns
  - Green checkmark: all checks passed
  - Yellow warning: passed after self-correction
  - Red X: failed, presented to user with errors
- [ ] Undo button placement
  - Small "Undo" link next to each agent turn that modified files
  - "Undo all changes" button in conversation header

### Phase 5: Configuration

- [ ] Project-level verification config (`.openwaggle/verification.json`)
  ```json
  {
    "enabled": true,
    "stages": {
      "typecheck": { "command": "pnpm typecheck", "timeout": 30000 },
      "lint": { "command": "pnpm lint", "timeout": 15000 },
      "test": { "command": "pnpm test:unit", "timeout": 60000 }
    },
    "selfCorrection": {
      "maxAttempts": 1,
      "neverModifyTests": true
    }
  }
  ```
- [ ] Auto-detect if no config exists (read package.json scripts)
- [ ] Settings panel toggle: enable/disable verification, configure timeouts
- [ ] Per-conversation override: "Skip verification for this conversation" (for prototyping)

---

## Performance Budget

| Stage | Expected Duration | Notes |
|-------|------------------|-------|
| Typecheck | 2-10s | Depends on project size, incremental helps |
| Lint | 1-5s | Biome is fast, ESLint slower |
| Affected tests | 2-30s | Only tests for changed files |
| **Total** | **5-45s** | Runs in background, agent can continue |

The pipeline runs **in parallel with the agent's next thought**. The agent doesn't wait — it continues generating. If verification fails, it gets interrupted with the failure.

---

## The "Never Edit Tests" Rule

This is the single most important design decision. When agents encounter test failures, they have two options:

1. Fix the source code (correct)
2. Fix the tests to match the broken source code (wrong)

Agents overwhelmingly choose option 2 because it's easier — fewer files to change, guaranteed to make the test pass. But it defeats the purpose of testing.

The self-correction prompt explicitly forbids this:
> "Tests exist to verify correct behavior. If a test fails after your change, your change is likely wrong — not the test. Fix your source code. The only exception is when the user explicitly asked you to change the tested behavior, in which case updating the test is correct."

---

## Files to Create

- `src/main/agent/verification-runner.ts` — runs typecheck/lint/test pipeline
- `src/main/agent/affected-tests.ts` — determines which tests to run
- `src/main/agent/checkpoint-manager.ts` — git-based undo
- `src/renderer/src/components/chat/VerificationStatus.tsx` — inline status UI
- `src/renderer/src/components/chat/UndoButton.tsx` — undo turn UI

## Files to Modify

- `src/main/agent/agent-loop.ts` — hook verification after tool calls
- `src/main/tools/tools/write-file.ts` — trigger verification after write
- `src/main/tools/tools/edit-file.ts` — trigger verification after edit
- `src/shared/types/ipc.ts` — verification status + undo IPC channels
- `src/renderer/src/components/chat/MessageBubble.tsx` — verification badges + undo

---

## Verification (meta)

- [ ] Agent writes code with a type error → pipeline catches it → agent self-corrects
- [ ] Agent writes code that fails a test → agent fixes source code, NOT the test
- [ ] Self-correction cap: agent fails twice → presents error to user, doesn't loop
- [ ] Undo button reverts all files from last agent turn
- [ ] Pipeline auto-detects typecheck/lint/test commands from project config
- [ ] Verification status shows in real-time in chat UI
- [ ] Pipeline timeout prevents hanging on slow test suites
- [ ] Verification can be disabled per-conversation for prototyping
