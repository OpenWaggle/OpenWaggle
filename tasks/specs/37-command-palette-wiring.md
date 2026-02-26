# 37 — Command Palette Wiring

**Status:** Planned
**Priority:** P3
**Category:** Fix (UI debt)
**Depends on:** Related specs for underlying features
**Origin:** Waggle conversation review (GPT 5.2 + GPT 5.1 Codex analysis)

---

## Problem

`src/renderer/src/components/command-palette/CommandPalette.tsx` contains 5 base commands (line 112-151) where the action is just `() => closeCommandPalette()` — a no-op. Users open the command palette, see these items, click them, and nothing happens. This violates the UI Interaction PRD principle of "no clickable control without defined behavior."

### Specific no-op commands

| Command | Line | Icon | Has Spec? | Spec Wire Plan? |
|---------|------|------|-----------|-----------------|
| `code-review` | 121-125 | GitPullRequest | Yes (Spec 28 skill) | **No** — skill exists but palette doesn't invoke it |
| `feedback` | 126-131 | MessageSquare | Yes (Spec 35 Phase 1.4) | **No** — feedback system planned but palette not mentioned |
| `new-worktree` | 132-137 | GitBranch | **No** | N/A |
| `personality` | 138-143 | Smile | **No** | N/A |
| `plan-mode` | 144-151 | Layers | **No** | N/A |

The key insight from the waggle review: even when the underlying feature gets implemented (e.g., Spec 28 code-review skill, Spec 35 feedback system), **nothing in those specs plans to wire the command palette entries to them**. So these dead-end commands will persist even after those features ship.

### Only `waggle` works

The `cowork` command (line 113-119) is the only base command with real behavior — it either starts a collaboration via `handleStartCowork()` or opens the Waggle Mode settings tab via `handleConfigureCowork()`. This proves the pattern works; the other 5 just need similar wiring.

## Implementation

### Approach: Wire or Remove

For each no-op command, one of:

**A. Wire to existing/planned feature:**
- `code-review` → Invoke the `code-review` skill via `onSelectSkill('code-review')` if installed, or show "Install code-review skill" prompt
- `feedback` → Open a feedback dialog (when Spec 35 Phase 1.4 ships), or for now navigate to GitHub issues URL

**B. Wire to new feature (requires its own spec):**
- `new-worktree` → See Spec 42 (Git Worktrees)
- `personality` → See Spec 41 (Personalization)
- `plan-mode` → See Spec 40 (Plan Mode)

**C. Remove until feature exists:**
- If the underlying feature isn't implemented and has no near-term timeline, remove the palette entry to avoid dead-end UX

### Recommended phased approach

- [ ] **Immediate**: Remove `new-worktree`, `personality`, `plan-mode` from the palette (no backing feature exists)
- [ ] **When Spec 28 ships**: Wire `code-review` to invoke the code-review skill
- [ ] **When Spec 35 ships**: Wire `feedback` to open the feedback dialog
- [ ] **When Specs 40/41/42 ship**: Re-add the respective palette entries with real actions
- [ ] Add a validation rule: every `CommandItem` in `baseCommands[]` must have an `action` that does more than `closeCommandPalette()`

## Files to Touch

- `src/renderer/src/components/command-palette/CommandPalette.tsx` — remove dead commands, wire live ones
- Future: add commands back as their backing features ship

## Tests

- Unit: every `baseCommands` entry's `action` does something beyond closing the palette
- Component: clicking a command triggers the expected navigation/action

## Design Context

The command palette is modeled after VS Code / Linear — a power-user surface that should be highly reliable. Dead commands in a command palette are worse than missing commands because they train users to distrust the palette. It's better to show 2 working commands than 7 where 5 do nothing.
