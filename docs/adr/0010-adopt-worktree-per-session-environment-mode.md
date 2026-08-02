# Adopt Worktree-Per-Session Environment Mode

Status: accepted

Supersedes the implicit "no git worktrees" stance currently encoded in the renderer surfaces. OpenWaggle historically ran all git work in the single opened checkout, and component tests assert the worktree surface is absent:

- `src/renderer/src/features/settings/components/__tests__/SettingsShell.component.test.tsx` — `expect(screen.queryByRole('button', { name: /Worktrees/ })).not.toBeInTheDocument()`
- `src/renderer/src/features/command-palette/lib/__tests__/command-palette-lib.unit.test.ts` — commands do not contain `new-worktree`
- `src/renderer/src/routes/__tests__/-route-surfaces.component.test.tsx` — a disabled `'worktrees'` route surface

To reach T3Code-parity for per-session isolation, branch diffs, and per-turn checkpointing, OpenWaggle adopts a **Session environment mode** and **Session worktrees**. This ADR records that reversal and its lifecycle rules.

## Context

A **SessionBranch** in OpenWaggle is a conversation-tree fork of the Pi message tree; it is not a git branch. Git actions previously operated on the one working tree at the opened project path, so two divergent lines of agent work would collide in a single working tree and their file changes could not be attributed cleanly.

T3Code isolates each thread with an optional git worktree chosen per thread via an environment mode. That isolation is what makes per-thread change-request state and per-turn diffs well-defined.

## Decision

Introduce **Session environment mode** on the session model, with a configurable global default:

- `local` — the session runs directly in the opened checkout; no worktree is created (`worktreePath` is null). This preserves today's behavior and remains a valid, first-class mode.
- `worktree` — the session runs in a dedicated **Session worktree**: a git worktree plus a temporary git branch, created off a user-chosen base ref.

Cardinality and relationships:

- A session in `worktree` mode owns exactly one **Session worktree**.
- All of that session's **SessionBranches** (conversation forks) share the same Session worktree. OpenWaggle does not create a worktree per conversation fork; T3Code has no per-fork worktree concept and inventing one would contradict parity.
- A `local`-mode session owns no worktree and edits the opened checkout.

Storage:

- Session worktrees live in app-owned, out-of-repo storage, for example `~/.openwaggle/worktrees/<repoId>/<sessionId>`, so the user's project directory is never littered with sibling worktree folders.

Lifecycle:

- **Birth** — created on send in `worktree` mode, only after a base ref is chosen. If the mode is `worktree` and no base ref is selected, block the send with a typed error (mirrors T3Code's "Select a base branch before sending in New worktree mode").
- **Death** — removed on session archive/delete via `git worktree remove`. Rely on git's native refusal to remove a dirty worktree; pass `--force` only on explicit user request. A worktree is only removable when no other session shares its path (orphan guard ported from T3Code `worktreeCleanup.ts`).

Re-enable the worktree renderer surface (settings entry, command, route) that the tests above currently assert absent, and update those tests to reflect the new first-class behavior.

## Consequences

- Sessions gain a persisted `environmentMode` field and the global default setting must be surfaced in settings.
- A main-process worktree service behind a port owns create/remove/list/orphan-detection, returning discriminated-union results.
- Diff and status code must resolve the correct working directory per session (opened checkout for `local`, the Session worktree path for `worktree`).
- The three renderer tests that assert worktree absence must be inverted; the worktree surface becomes supported product behavior.
- Per-turn checkpointing (ADR 0011) and branch diffs depend on this isolation and assume the Session worktree path as their working directory in `worktree` mode.

## Non-goals

- No per-SessionBranch (per-conversation-fork) worktrees.
- No automatic migration of existing `local` sessions into worktrees.
- No worktree support for non-git project directories.
