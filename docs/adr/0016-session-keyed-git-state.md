# Session-Keyed Git State, Observed Rather Than Declared

Status: accepted (not yet implemented — see Staging)

OpenWaggle keys its git surface to the **active session's working tree** rather than to the project, and keeps that state fresh by **observing** git instead of requiring the agent to announce what it did.

## Context

Two halves of the app disagree about which working tree they are looking at.

| Side | Path used | Source |
| --- | --- | --- |
| Agent / main process | the **Session worktree** | `waggle-run.ts` → `ensureSessionWorktreeProjectPath(session)` |
| UI / renderer | the **primary checkout** | `useProject` → `usePreferencesStore(s => s.settings.projectPath)` |

The renderer never passes a session's `worktreePath` to a git read. Its only uses of that field are the Settings worktree list and a `hasWorktree` boolean.

For a session in `worktree` environment mode this means:

- **Working tree** and **Branch** diff scopes read the primary checkout, so the panel reports "No changes to review" while the agent has been editing files in its worktree. That is the whole purpose of the diff panel (issue #30) failing in that mode.
- The run-target chip shows the primary checkout's branch, not the session's.
- **Stage all / Revert all / Commit** act on the primary checkout — self-consistent with what is displayed, but never touching the work being reviewed.
- **Turn diff** is correct, because per-turn checkpoints are captured from the worktree and keyed by session (ADR 0011).

That asymmetry — one scope correct, two pointing at the wrong repository — is why this survived unnoticed.

Separately, nothing tells OpenWaggle when git state changes underneath it. `invalidateGitStatusCache` is called only from OpenWaggle's own mutation handlers (commit, stage-all, revert-all). There is no filesystem or git watcher. The diff panel has no subscription to agent run state. So an agent that runs `git checkout -b`, `git worktree add` or `git stash` — all of which it can already do, since its cwd *is* the worktree — changes reality that the UI never learns about.

### Constraint that shaped the design

The agent must not be required to remember anything. No announce-your-changes protocol, no bespoke tools it must prefer over plain git. Whatever it does with ordinary git commands has to be picked up automatically.

### Layout fact that makes observation cheap

Every linked worktree's `HEAD`, `index` and metadata live under the **primary** repository's `.git/worktrees/<name>/`, verified against this repository's own worktrees. One watch root per project therefore covers every session:

| Path under the primary `.git` | Signals |
| --- | --- |
| `refs/heads/**`, `packed-refs` | branch created, deleted, moved |
| `worktrees/*/HEAD` | any Session worktree switched ref |
| `worktrees/*` added or removed | worktree created or pruned |
| `HEAD`, `index` | primary checkout ref, staging |
| `worktrees/*/index` | staging inside a Session worktree |

## Decision

**1. Git is the source of truth for current state; the session record holds birth facts as provenance.** `worktreeBaseRef` and `worktreeStartFromOrigin` describe how the worktree was *born* and stay immutable — per-turn checkpointing anchors Turn diffs to them (ADR 0011), so overwriting them would strand historical diffs. The worktree's *current* ref is read from git, never declared.

**2. Observe per turn and via a `.git` watcher. No polling.** Reconciliation runs beside the existing `captureTurnCheckpoint` call (already invoked after every turn in both run paths) and is additionally driven by one debounced recursive watcher per project rooted at the primary `.git`. Polling was rejected: it costs work while idle and is still stale when busy. Per-turn alone was rejected because a long turn, or a change made outside OpenWaggle, would leave the UI wrong for minutes.

**3. Broadcast path-scoped invalidation events, not state.** `git:refs-changed`, `git:head-changed`, `git:worktrees-changed`, `git:index-changed`, each carrying the project path and, where applicable, the working path. Subscribers filter on their own working tree. A single coarse `git:changed` was rejected because it fans out: session A would re-run a full `git diff` because session B's index changed, and diffs are expensive enough here to carry an explicit `maxBuffer`. Pushing computed state was rejected because it couples the event schema to every consumer and puts large payloads on the IPC bus; invalidate-and-let-the-owner-fetch matches how `invalidateGitStatusCache` already works. The watcher becomes a third caller of that existing function rather than a parallel mechanism.

**4. Status, diffs and working-tree mutations are keyed to the session's working tree.** A renderer-side resolver mirrors `session-manager.ts`: the Session worktree path in `worktree` mode, otherwise the project path. Branch lists, worktree lists and remotes stay **project-keyed** — a linked worktree shares `refs/` with the primary, so those are genuinely repository-level.

**5. Git state is stored as a map keyed by working path.** Per-session state coexists, so background sessions can carry their own status. This is what makes per-session indicators (dirty, ahead/behind) in the session tree possible; a single slot could not represent two sessions on two worktrees.

## Consequences

- The diff panel starts showing the agent's actual work in worktree mode. Today it shows nothing.
- **Stage / Revert / Commit change target.** They will act on the session's worktree instead of the primary checkout. This is the intended fix, but it is a behavioural change to destructive actions and must be obvious in the UI, not silent.
- The store shape changes from one slot to a map. `statusProjectPath` (an existing stale-guard) generalises into the map key.
- The watcher adds one recursive `fs.watch` per open project. Supported on macOS, Windows and Linux under Node 24; Linux consumes more inotify handles, bounded by one root per project rather than per session.
- Debouncing is mandatory, not an optimisation: `.git` churns hard during any operation — `index.lock` create/delete alone fires several events per `git add`.
- A Session worktree's branch is now **observed**, so the glossary definition changes (below).

## Terminology impact

CONTEXT.md defined a **Session worktree** as "a dedicated git worktree *plus its temporary git branch*" whose base ref is "*frozen* once the worktree exists". Once the agent can switch branches inside it, the worktree persists while the branch moves. The worktree is owned by OpenWaggle; its current branch is observed. "Frozen" now applies only to the **Worktree base ref** as birth provenance.

## Staging

Sequenced so each step is independently verifiable:

1. Working-tree resolver + map-keyed git store; every renderer git read/write routed through the resolver.
2. Per-turn reconciliation beside `captureTurnCheckpoint`, with typed broadcast events.
3. The `.git` watcher feeding the same reconciliation path.
4. Per-session indicators in the session tree (the reason for the map).

## Alternatives considered

**Require the agent to declare changes** (bespoke tools, or a post-turn report). Rejected outright: it fails the constraint that the agent must not have to remember anything, and it silently breaks whenever the agent reaches for plain `git`.

**Keep project-keyed state and rely on Turn diffs for worktree sessions.** Rejected: it abandons the review surface in the mode we are asking people to use, and leaves two of three diff scopes meaningless.

**Show a project view and a session view side by side.** Rejected: it doubles the UI to expose a distinction most users should not have to think about.

**Polling.** Rejected as above — cost when idle, staleness when busy, and no guarantee at any moment.
