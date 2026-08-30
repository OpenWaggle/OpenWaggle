# Adopt Worktree-Per-Session Environment Mode

Status: accepted; one-session/one-worktree ownership cardinality superseded by ADR 0025

ADR 0025 replaces the ownership unit with a shareable Workspace resource. The local-versus-worktree environment distinction, managed storage, git-native dirty-removal protection, and no-worktree behavior for non-Git projects remain in force; session-exclusive worktree identity and cleanup do not.

Supersedes the implicit "no git worktrees" stance currently encoded in the renderer surfaces. OpenWaggle historically ran all git work in the single opened checkout, and component tests assert the worktree surface is absent:

- `src/renderer/src/features/settings/components/__tests__/SettingsShell.component.test.tsx` — `expect(screen.queryByRole('button', { name: /Worktrees/ })).not.toBeInTheDocument()`
- `src/renderer/src/features/command-palette/lib/__tests__/command-palette-lib.unit.test.ts` — commands do not contain `new-worktree`
- `src/renderer/src/routes/__tests__/-route-surfaces.component.test.tsx` — a disabled `'worktrees'` route surface

To support per-session isolation, branch diffs, and per-turn checkpointing, OpenWaggle adopts a **Session environment mode** and **Session worktrees**. This ADR records that reversal and its lifecycle rules.

## Context

A **SessionBranch** in OpenWaggle is a conversation-tree fork of the Pi message tree; it is not a git branch. Git actions previously operated on the one working tree at the opened project path, so two divergent lines of agent work would collide in a single working tree and their file changes could not be attributed cleanly.

The established approach isolates each session with an optional git worktree, chosen per session via an environment mode. That isolation is what makes per-session change-request state and per-turn diffs well-defined: without it, two sessions editing the same checkout produce diffs that cannot be attributed to either.

## Decision

Introduce **Session environment mode** on the session model, with a configurable global default:

- `local` — the session runs directly in the opened checkout; no worktree is created (`worktreePath` is null). This preserves today's behavior and remains a valid, first-class mode.
- `worktree` — the session runs in a dedicated **Session worktree**: a git worktree plus a temporary git branch, created off a user-chosen base ref.

Cardinality and relationships:

- A session in `worktree` mode owns exactly one **Session worktree**.
- All of that session's **SessionBranches** (conversation forks) share the same Session worktree. OpenWaggle does not create a worktree per conversation fork: a fork is an alternative conversation over the same working state, so giving each one its own checkout would multiply worktrees without isolating anything meaningful.
- A `local`-mode session owns no worktree and edits the opened checkout.

Storage:

- Session worktrees live in app-owned, out-of-repo storage, for example `~/.openwaggle/worktrees/<repoId>/<sessionId>`, so the user's project directory is never littered with sibling worktree folders.

Lifecycle:

- **Birth** — created on send in `worktree` mode, only after a base ref is chosen. If the mode is `worktree` and no base ref is selected, block the send with a typed error ("Select a base branch before sending in New worktree mode") rather than silently running in the opened checkout.
- **Birth progress** — projects app-owned stages `Preparing workspace`, `Checking out files`, `Worktree created`, and `Starting a task` until Pi emits its first agent activity. The active stage is indeterminate unless the underlying operation provides measurable progress. Optional stages and percentages are never simulated, and `More details` exposes actual operation output and diagnostics.
- **Birth trace** — once creation succeeds, the bordered progress panel collapses to a compact `Worktree created` line while `Starting a task` remains active. Starting Pi replaces that live launch state with durable app-owned transcript activity named `Worktree created`, whose disclosure retains the real worktree output. An additional setup trace exists only when an optional setup operation actually ran. The trace is not an assistant message or a Pi agent phase.
- **No false trace** — working locally or cancelling before successful worktree creation leaves no `Worktree created` transcript activity.
- **Launch-plan lock** — pressing Send freezes the chosen environment mode and worktree base ref before birth starts. The composer keeps showing the environment and actual checked-out branch as separate read-only context. A later Git branch change updates the displayed branch but never rewrites the immutable worktree base ref.
- **Birth failure** — retains one submitted user turn and presents `Retry`, `Work locally`, `Cancel`, and `More details` in a `Worktree setup failed` state. Retry reconciles any partial setup before continuing that retained turn once. Work locally continues it once in the opened checkout. Cancel performs the same transcript rollback and exact draft restoration as cancellation during active birth. The retained turn is never copied into the composer while the failure remains visible.
- **Work locally during birth** — records `local` mode on the same session and continues the already-submitted turn exactly once in the opened checkout. It is a fallback for that run, not a second user send, so it preserves one user message and one session.
- **Cancel during birth** — stops the launch, removes the optimistic transcript turn, and restores the exact pre-send composer draft, including attachments and any skill or Waggle invocation.
- **Death** — removed on session archive/delete via `git worktree remove`. Rely on git's native refusal to remove a dirty worktree; pass `--force` only on explicit user request. A worktree is only removable when no other session shares its path, so cleanup never deletes a checkout another line of work is using.

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
