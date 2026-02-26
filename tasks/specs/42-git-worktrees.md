# 42 — Git Worktrees

**Status:** Planned
**Priority:** P4
**Category:** Feature
**Depends on:** None (benefits from Spec 44 Git Settings for configuration surface)
**Origin:** Waggle conversation review — CommandPalette has "New worktree" no-op (line 132-137), SettingsNav has disabled "Worktrees" tab (line 28), `SettingsTab` type includes `'worktrees'` (ui-store.ts line 14)

---

## Problem

Git worktrees are a key workflow for coding agents — they allow parallel work on multiple branches without stashing or context-switching. The product has two dead-end UI touchpoints but no implementation:

- `CommandPalette.tsx` line 132-137: `new-worktree` command — `action: () => closeCommandPalette()` (no-op)
- `SettingsNav.tsx` line 28: `worktrees` tab — `enabled: false`

### Why Worktrees Matter for a Coding Agent

1. **Parallel experimentation**: "Try approach A in one worktree, approach B in another, compare"
2. **Safe exploration**: Agent can experiment in an isolated worktree without affecting the main working directory
3. **Multi-task**: User can have the agent work on a feature branch in a worktree while they continue work in the main directory
4. **Review workflow**: Create a worktree to review a PR while keeping current work untouched

### What Exists

- **`runCommand` tool** (`src/main/tools/tools/run-command.ts`): The agent can already execute `git worktree add` via the command tool, but there's no structured support:
  - No UI for managing worktrees
  - No integration with conversation context (agent doesn't know which worktree it's operating in)
  - No cleanup mechanism (orphaned worktrees accumulate)
  - No worktree-aware project path resolution

### Reference: How other tools do this

| Tool | Worktree Support |
|------|-----------------|
| Claude Code | Implicit — each task agent can run in its own worktree via `--worktree` flag |
| VS Code | Multi-root workspace — each worktree appears as a workspace folder |
| GitKraken | Visual worktree management with create/switch/remove |
| JetBrains | Worktree support in Git tool window |

## Architecture

### Worktree Lifecycle

```
User clicks "New worktree" in command palette
  → Dialog: branch name, base ref, location (default: adjacent to project dir)
  → Main process: git worktree add <path> -b <branch> [<base>]
  → Register worktree in app state
  → Option: open conversation scoped to the new worktree path
  → Agent's projectPath is set to the worktree directory
  → All tool operations (read, write, edit, run) use worktree as CWD
```

### Worktree Registry

Track active worktrees in memory (derived from `git worktree list`):

```typescript
interface WorktreeEntry {
  path: string           // Absolute filesystem path
  branch: string         // Branch checked out in this worktree
  isMain: boolean        // Whether this is the main working directory
  head: string           // Current HEAD commit SHA
  createdAt: number      // When this worktree was created via the app
}
```

Not persisted separately — always derived from `git worktree list --porcelain` at query time, enriched with app metadata.

## Implementation

### Phase 1: Worktree operations (main process)

- [ ] Create `src/main/git/worktree.ts`:
  - `listWorktrees(projectPath: string): Promise<WorktreeEntry[]>` — parse `git worktree list --porcelain`
  - `createWorktree(projectPath: string, opts: { branch: string; baseBranch?: string; location?: string }): Promise<WorktreeEntry>`
  - `removeWorktree(projectPath: string, worktreePath: string, opts?: { force?: boolean }): Promise<void>`
  - `pruneWorktrees(projectPath: string): Promise<void>` — remove stale entries
- [ ] Add IPC channels:
  - `'git:list-worktrees'` → list active worktrees
  - `'git:create-worktree'` → create new worktree
  - `'git:remove-worktree'` → remove worktree
  - `'git:prune-worktrees'` → clean up stale entries

### Phase 2: Command palette integration

- [ ] Wire `new-worktree` command in `CommandPalette.tsx`:
  - Open a dialog/modal for worktree creation
  - Fields: branch name (required), base branch (default: current), location (default: `../<project>-<branch>`)
  - On success: show toast, optionally open new conversation scoped to worktree
- [ ] Add `list-worktrees` command to palette: shows all active worktrees with switch action

### Phase 3: Settings UI (Worktrees tab)

- [ ] Enable `worktrees` tab in `SettingsNav.tsx` (line 28)
- [ ] Create `src/renderer/src/components/settings/sections/WorktreesSection.tsx`:
  - List all active worktrees for current project
  - Each entry shows: path, branch, HEAD, status (clean/dirty)
  - Actions: open in conversation, remove, copy path
  - "Prune stale worktrees" button
- [ ] Add to `SettingsPage.tsx` tab switch

### Phase 4: Agent-aware worktree context

- [ ] When a conversation's `projectPath` points to a worktree (not the main working directory):
  - Show indicator in conversation header: "Worktree: feature/xyz"
  - Agent system prompt includes worktree context: "You are working in a git worktree at <path>, branch <branch>"
  - Tool paths resolve relative to the worktree, not the main project
- [ ] Conversation handoff (Spec 19, done) should support "continue in worktree" as a handoff target

## Files to Create

- `src/main/git/worktree.ts` — worktree CRUD operations
- `src/renderer/src/components/settings/sections/WorktreesSection.tsx` — settings tab
- `src/renderer/src/components/command-palette/WorktreeDialog.tsx` — creation dialog

## Files to Modify

- `src/shared/types/ipc.ts` — worktree IPC channels
- `src/renderer/src/components/command-palette/CommandPalette.tsx` — wire new-worktree command (line 132-137)
- `src/renderer/src/components/settings/SettingsNav.tsx` — enable worktrees tab (line 28)
- `src/renderer/src/components/settings/SettingsPage.tsx` — add WorktreesSection to tab switch
- `src/main/agent/system-prompt.ts` — worktree context in system prompt

## Tests

- Unit: `listWorktrees` parses `git worktree list --porcelain` output correctly
- Unit: `createWorktree` constructs correct git command
- Unit: `removeWorktree` handles force and non-force cases
- Component: worktree dialog validates branch name
- Component: worktrees settings tab renders active worktree list
- Integration: create → list → remove lifecycle works end-to-end
