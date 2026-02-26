# 44 — Git Settings

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Waggle conversation review — SettingsNav has disabled "Git" tab (line 26), `SettingsTab` type includes `'git'` (ui-store.ts line 12)

---

## Problem

The product is a coding agent that heavily interacts with git (via `runCommand` tool), but has no git-specific configuration surface. Users cannot control:

1. **Default branch behavior**: What branch the agent creates when starting work, naming conventions
2. **Commit conventions**: Whether the agent auto-commits, commit message format, co-author handling
3. **Safety guardrails**: Which git operations the agent can perform without approval (push, force-push, branch delete, etc.)
4. **Git identity**: Author name/email used for agent-created commits
5. **Auto-operations**: Whether to auto-stage, auto-stash, auto-pull before starting work

### What Exists

- `SettingsNav.tsx` line 26: `git` tab — `enabled: false`
- `ui-store.ts` line 12: `SettingsTab` type includes `'git'`
- `SettingsPage.tsx`: No handler for `git` tab
- **`runCommand` tool** (`src/main/tools/tools/run-command.ts`): Has `needsApproval: true` — all git commands require user approval. This is the right default, but power users may want to auto-approve safe operations (status, log, diff) while keeping destructive ones gated.
- **CLAUDE.md Git Workflow section**: Defines conventions the agent should follow (branch naming, commit format, no force push, etc.) — but these are prompt-level instructions, not enforced settings.

### Reference: How other tools do this

| Tool | Git Configuration |
|------|------------------|
| Claude Code | `allowedTools` in settings — granular control over which git operations are auto-approved |
| VS Code | Git settings panel — auto-fetch, default branch, post-commit command |
| GitKraken | Preferences → Git — default clone directory, auto-prune, GPG signing |
| Cursor | Composer git mode — auto-commit with generated messages |

## Architecture

### Git Configuration

```typescript
interface GitConfig {
  /** Branch naming template: e.g., "feat/{slug}" */
  branchTemplate: string

  /** Commit message format */
  commitFormat: {
    /** Whether to include scope: "feat(scope): desc" vs "feat: desc" */
    includeScope: boolean
    /** Whether to add co-author line */
    addCoAuthor: boolean
    /** Co-author line template */
    coAuthorLine: string
  }

  /** Safety: git operations that DON'T require approval */
  autoApproveOperations: Array<
    'status' | 'log' | 'diff' | 'branch-list' | 'stash-list' |
    'add' | 'commit' | 'checkout-branch' | 'pull' | 'push' |
    'stash' | 'stash-pop'
  >

  /** Dangerous operations that are ALWAYS blocked (even if user tries to approve) */
  blockedOperations: Array<
    'force-push' | 'reset-hard' | 'clean-f' | 'branch-D'
  >

  /** Auto-operations before agent starts work */
  autoOperations: {
    /** Auto-pull before starting new work */
    pullBeforeWork: boolean
    /** Auto-stash uncommitted changes before branch switch */
    stashBeforeSwitch: boolean
    /** Auto-fetch to keep remote refs current */
    autoFetch: boolean
    /** Fetch interval in minutes (0 = disabled) */
    fetchInterval: number
  }
}
```

### Integration Points

1. **`runCommand` tool**: Check git config before executing git commands
   - If command matches `autoApproveOperations` → skip approval
   - If command matches `blockedOperations` → reject with explanation
   - Otherwise → standard approval flow
2. **Agent system prompt**: Inject git conventions (branch template, commit format)
3. **Conversation start**: If `autoOperations.pullBeforeWork` → auto-pull on first message

## Implementation

### Phase 1: Git config storage

- [ ] Define `GitConfig` type in `src/shared/types/settings.ts`
- [ ] Store in `electron-store`
- [ ] Add IPC channels:
  - `'settings:get-git-config'` → returns `GitConfig`
  - `'settings:set-git-config'` → saves updated config
- [ ] Sensible defaults:
  - `branchTemplate`: `"{type}/{slug}"` (matches CLAUDE.md convention)
  - `autoApproveOperations`: `['status', 'log', 'diff', 'branch-list', 'stash-list']`
  - `blockedOperations`: `['force-push', 'reset-hard', 'clean-f', 'branch-D']`
  - `autoOperations`: all false (conservative default)
  - `commitFormat.addCoAuthor`: true, with model-appropriate co-author line

### Phase 2: runCommand integration

- [ ] In `src/main/tools/tools/run-command.ts`:
  - Parse incoming command to detect git operations
  - Simple heuristic: starts with `git ` → extract subcommand
  - Check against `autoApproveOperations` → if matched, override `needsApproval` to false
  - Check against `blockedOperations` → if matched, return error result without executing
- [ ] Create `src/main/git/command-classifier.ts`:
  - `classifyGitCommand(command: string): { operation: string; isDangerous: boolean; isAutoApprovable: boolean }`
  - Handles compound commands: `git add . && git commit -m "..."` → classify each part

### Phase 3: Settings UI

- [ ] Enable `git` tab in `SettingsNav.tsx` (line 26)
- [ ] Create `src/renderer/src/components/settings/sections/GitSection.tsx`:
  - **Branch Template**: text input with live preview ("feat/add-user-auth")
  - **Commit Format**: toggles for scope, co-author, template preview
  - **Auto-Approve Operations**: checklist of git operations
    - Safe operations (status, log, diff) pre-checked
    - Risky operations (push, commit) unchecked with warning icon
  - **Blocked Operations**: checklist (force-push, reset-hard always checked, with "strongly recommended" labels)
  - **Auto-Operations**: toggles for pull-before-work, stash-before-switch, auto-fetch + interval
- [ ] Add to `SettingsPage.tsx` tab switch

### Phase 4: System prompt integration

- [ ] Inject git conventions into agent system prompt:
  - Branch naming template
  - Commit message format (if different from default)
  - Blocked operations (so agent doesn't attempt them)
- [ ] This replaces relying solely on CLAUDE.md for git conventions — makes them enforceable settings

## Files to Create

- `src/main/git/command-classifier.ts` — parse and classify git commands
- `src/renderer/src/components/settings/sections/GitSection.tsx` — settings tab

## Files to Modify

- `src/shared/types/settings.ts` — add `GitConfig`
- `src/shared/types/ipc.ts` — git config IPC channels
- `src/main/tools/tools/run-command.ts` — git command auto-approve/block logic
- `src/renderer/src/components/settings/SettingsNav.tsx` — enable git tab (line 26)
- `src/renderer/src/components/settings/SettingsPage.tsx` — add GitSection
- `src/main/agent/system-prompt.ts` — inject git conventions

## Tests

- Unit: command classifier correctly identifies git operations (`git status` → status, `git push --force` → force-push)
- Unit: compound commands classified correctly (`git add . && git commit` → [add, commit])
- Unit: auto-approve logic skips approval for whitelisted operations
- Unit: blocked operations rejected before execution
- Component: git settings tab renders all configuration sections
- Component: auto-approve checklist changes propagate to stored config
