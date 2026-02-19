---
name: task-workflow
description: Mandatory workflow for all development tasks. Use this skill when starting any task. Covers planning, implementation, testing, and PR creation with knowledge transfer via LEARNINGS.md.
---

# Task Workflow

**This workflow is MANDATORY. Skipping steps invalidates your work.**

---

## Phase 1: Setup (BEFORE writing any code)

### 1.1 Read LEARNINGS.md
```bash
# Read sections 1-4, skip Archive
cat LEARNINGS.md
```
Note any warnings relevant to your task. Apply them.

### 1.2 Confirm to User
Tell the user:
> "Starting task: [description]
> Relevant warnings from LEARNINGS.md: [list any, or 'None']"

**DO NOT write any code until you have completed 1.1-1.2.**

---

## Phase 2: Plan (REQUIRED for non-trivial tasks)

### 2.1 Enter Plan Mode
Use `EnterPlanMode` tool. In plan mode:
- Explore codebase thoroughly
- Keep plan extremely concise
- End with: "Unresolved questions:" (list any, or "None")

### 2.2 Get Approval
Wait for user to approve plan before proceeding.

### 2.3 Exit Plan Mode
Use `ExitPlanMode` when ready to implement.

**Skip Phase 2 only for:** typo fixes, simple config changes, dependency updates.

---

## Phase 3: Implement

### 3.1 Write Code
- Follow existing codebase patterns
- Respect React Compiler rules (no manual memoization)
- Check `LEARNINGS.md` warnings as you work

### 3.2 Commit Frequently
After EACH logical unit of work:
```bash
git add <files>
git commit -m "<type>(<scope>): <description>"
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

**BAD:** One giant commit at the end
**GOOD:** 3-5+ atomic commits during implementation

---

## Phase 4: Test (REQUIRED)

### 4.1 Unit Tests
```bash
pnpm test                           # All tests
pnpm test src/path/to/file.test.tsx # Specific file
```
Every feature needs unit tests. No exceptions.

### 4.2 E2E Tests (if applicable)
**Required for:** UI changes, user flows, multi-step interactions
**Skip for:** Backend-only, refactors, utilities

```bash
pnpm test:e2e
```

### 4.3 Type Check
```bash
pnpm typecheck
```
Fix any errors before proceeding.

---

## Phase 5: QA (DO NOT skip this phase)

Use browser tools to verify:

```
# Check for console errors
# Verify network requests succeed  
# Confirm UI renders correctly
```

**Skip for:** Backend-only changes, non-visual refactors.

---

## Phase 6: Push & Confirm

### 6.1 Push Commits
```bash
git push
```

### 6.4 Notify User
> "PR created: [link]
> Ready for your review."

---

## Phase 7: Knowledge Transfer **(REQUIRED)**

### 7.1 Update LEARNINGS.md
Add your discoveries to "Recent Discoveries" section:
```markdown
### Task: <description> (YYYY-MM-DD)
- Learning 1
- Learning 2 [SKILL?]  ← mark significant ones
```

### 7.2 Curate If Needed
- If any section exceeds its cap, consolidate or archive oldest items
- Active Warnings: max 10
- Pattern Preferences: max 15
- Recent Discoveries: last 5 tasks

### 7.3 Skill Promotion
If YOUR learning is marked `[SKILL?]`, ask user:
> "This learning seems significant: [learning]. Should I create a skill for it?"

---

## Completion Checklist

Before marking task complete, verify ALL:

- [ ] Read LEARNINGS.md at start
- [ ] Multiple atomic commits (not one giant commit)
- [ ] Tests pass (`pnpm test`, `pnpm typecheck`)
- [ ] LEARNINGS.md updated with discoveries

---

## Exception Handling

### When Things Go Wrong

**Tests fail:**
1. Read error output carefully
2. Fix the issue
3. Commit the fix
4. Re-run tests

**Merge conflicts:**
1. `git fetch origin main`
2. `git rebase origin/main`
3. Resolve conflicts
4. `git push --force-with-lease`

---

## Quick Reference

```
BEFORE CODE:   LEARNINGS.md → confirm
PLANNING:      EnterPlanMode → plan → approve → ExitPlanMode
IMPLEMENTING:  code → commit → code → commit → code → commit
TESTING:       pnpm test → pnpm typecheck → (e2e if UI)
FINISHING:     LEARNINGS.md → commit → push → notify user
```

---

## Recent Learnings

### Task: Offline Whisper Base Voice Input (2026-02-19)
- `@xenova/transformers` can run Whisper-base locally in the Electron main process when audio is passed as normalized `Float32Array` PCM and the model cache is pinned to `app.getPath('userData')`.
- For Electron voice capture stability, record audio with `MediaRecorder` + local decode/resample in renderer and send PCM over IPC; avoid browser `SpeechRecognition` pathways in desktop shells.
- When using pnpm `onlyBuiltDependencies`, native modules required by transitive runtime deps (like `sharp` for `@xenova/transformers`) must be explicitly allowlisted or local model loading fails at runtime.

### Task: Composer Modal + Voice Crash Fixes (2026-02-19)
- In Electron dev shells, `window.prompt`/`window.confirm` can be unsupported in renderer contexts; use in-app modal flows for branch and permission actions.
- Setting `SpeechRecognition.processLocally = true` can trigger Chromium `OnDeviceSpeechRecognition` bad Mojo termination in Electron builds that do not expose that binder.

### Task: UI Product Gap Closure (2026-02-19)
- `electron-store` defaults can make migration checks ambiguous; use raw persisted settings presence (via store file) when deciding legacy-vs-new defaults for execution mode.
- Attachment pipelines should strip binary payloads before persistence and keep only path/metadata/extracted text in conversation JSON to avoid oversized history files.

### Task: Agent Loop Extensibility Foundation (2026-02-19)
- Treat the agent runtime as a feature pipeline (`prompt fragments + tool providers/filters + lifecycle hooks`) so new capabilities can be added without editing `runAgent` orchestration logic [SKILL?]
- Execution-mode policy should filter tools before dispatch (for clearer model behavior) while keeping execution-time guards as a second safety layer

### Task: Diff Review Panel (2026-02-19)
- Biome's `useExhaustiveDependencies` treats computed local variables (e.g. `const fetchKey = ...`) as "outer scope" and rejects them from deps arrays; use React `key` prop to force re-mount instead of `refreshKey` deps for data-fetching effects
- When parsing `git diff HEAD` output, split on `^diff --git ` boundary to get per-file chunks; the `b/` path from the header is the canonical file path for renames
- Diff panel theme tokens: `--color-diff-file-bg: #141922`, `--color-diff-file-border: #343d4d` for the card-style diff sections (distinct from the existing `--color-diff-card-*` tokens)

## Old Learnings Archive

Move old learnings here so we can review

### Task: Conversation Lifecycle + Git IPC Foundations (2026-02-19)
- In TanStack `useChat` IPC adapters, wiring `AbortSignal` directly to server-side cancellation causes runs to terminate when switching threads; use explicit user-cancel paths instead so background runs can complete [SKILL?]
- `needsApproval` server tools surface as `tool-call` parts in `approval-requested` state and require `addToolApprovalResponse()` wiring in the renderer, otherwise tool execution stalls indefinitely

### Task: Repository-Wide Review Remediation (2026-02-19)
- `fast-glob` can match parent-directory patterns like `../*` even with `cwd` set; validate glob inputs explicitly to keep file-discovery tools confined to the selected project root [SKILL?]
- Settings write-time validation (especially provider `baseUrl`) should match read-time validation to prevent silent fallback to defaults after restart

### Task: Test Coverage Baseline (2026-02-19)
- Vitest `vi.mock()` factories are hoisted before top-level variables; shared mock handles referenced inside factory closures should be initialized via `vi.hoisted(...)` to avoid runtime `ReferenceError` in integration tests [SKILL?]
- Electron e2e tests are deterministic when main-process `userData` can be overridden through an env var (`OPENHIVE_USER_DATA_DIR`), allowing relaunch persistence assertions without mutating local developer state

### Task: IPC Stream Termination During Tool Calls (2026-02-19)
- TanStack AI can emit an intermediate `RUN_FINISHED` with `finishReason: 'tool_calls'` before server tool execution results are streamed; treating any `RUN_FINISHED` as terminal in the renderer IPC adapter truncates later `TOOL_CALL_END.result` chunks and leaves tool blocks stuck running [SKILL?]

### Task: Agent File-Tool Stall Investigation (2026-02-19)
- TanStack AI server tool execution treats string returns as JSON-encoded payloads; plain-text tool outputs can surface as tool errors unless wrapped in a structured result contract (`kind: 'text' | 'json'`) [SKILL?]
- Persisted tool result error metadata should be derived in main-process stream handling (`TOOL_CALL_END`) and then mapped back into UI tool-result state; relying only on renderer-side content parsing causes contract drift

### Task: Backlog Completion (2026-02-19)
- For conversation schema refactors, keep persisted JSON backward-compatible by making removed fields optional in Zod and using legacy values to backfill per-message data during parse
- Root-level renderer error handling in React 19 still requires a class-based error boundary; wrap `<App />` in the boundary from `main.tsx` to avoid blank-screen failures
- `Object.fromEntries` can widen values to `string | undefined`; use an explicit `Record<string, SupportedModelId>` fill loop when strict prop types require defined values

### Task: Pencil "No Diff" UI Redesign (2026-02-18)
- Biome enforces `noStaticElementInteractions` — use CSS `group-hover:visible` / `invisible` pattern instead of `useState` hover tracking with `onMouseEnter`/`onMouseLeave` on `<div>`
- When restructuring layout (moving components between parent containers), update props interfaces in both parent and child to keep TypeScript happy
- New design tokens added to `@theme` block: `--color-input-card-border`, `--color-button-border`, `--color-diff-card-bg`, `--color-diff-card-border`, `--color-link-yellow` — use Tailwind classes like `border-input-card-border`, `bg-diff-card-bg`
- Composer now owns the status bar (Local/Full-access/git-branch) as its bottom row — no separate StatusBar component
- Inter font added as primary sans-serif in `--font-sans`
