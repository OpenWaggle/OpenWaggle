# Session-Keyed Git State

Status: accepted (not yet implemented — see Staging)

OpenWaggle keys its git surface to the **working path** of the active session — the Session worktree in worktree mode, the opened checkout in local mode — and refreshes that state whenever OpenWaggle itself changes git.

## Context

Two halves of the app disagree about which working tree they read.

| Side | Path used | Source |
| --- | --- | --- |
| Agent / main process | the **Session worktree** | `waggle-run.ts` → `ensureSessionWorktreeProjectPath(session)` |
| UI / renderer | the **primary checkout** | `useProject` → `usePreferencesStore(s => s.settings.projectPath)` |

The renderer never passes a session's `worktreePath` to a git read; its only uses of that field are the Settings worktree list and a `hasWorktree` boolean.

For a session in `worktree` mode this means:

- **Working tree** and **Branch** diff scopes read the primary checkout, so the panel reports "No changes to review" while the agent is editing files in its worktree. That is issue #30's entire purpose failing in that mode.
- The run-target chip shows the primary checkout's branch, not the session's.
- **Stage all / Revert all / Commit** act on the primary checkout — self-consistent with what is displayed, but never touching the work being reviewed.
- **Turn diff** is correct, because per-turn checkpoints are captured from the worktree and keyed by session (ADR 0011).

That asymmetry — one scope correct, two pointing at the wrong repository — is why it survived unnoticed. It also explains an observation initially written off as a QA probe artifact: local and worktree mode displayed the same branch, because both were reading the primary checkout.

## Decision

**1. Key status, diffs and working-tree mutations to the session's working path.** A renderer-side resolver mirrors `session-manager.ts`: the Session worktree path in `worktree` mode, otherwise the project path. Branch lists, worktree lists and remotes stay **project-keyed** — a linked worktree shares `refs/` with the primary checkout, so those are genuinely repository-level.

**2. Store git state as a map keyed by working path.** Per-session state coexists, which is what makes per-session indicators (dirty, ahead/behind) possible later. A single slot cannot represent two sessions on two worktrees.

**3. Refresh on OpenWaggle-initiated git changes, and push the invalidation.** Every git mutation we perform — commit, stage-all, revert-all, worktree create/remove, branch create/checkout, worktree birth — invalidates and broadcasts for the affected working path, so every window converges without asking. Invalidation carries the working path rather than being a coarse "git changed" signal: coarse events fan out, making session A re-run a full `git diff` because session B's index changed, and diffs here carry an explicit `maxBuffer`. Broadcasting an invalidation rather than computed state keeps the event schema decoupled from every consumer and keeps large diff payloads off the IPC bus; it also reuses the existing `invalidateGitStatusCache` instead of introducing a parallel mechanism.

**4. Record the branch and worktree path we set, at the moment we set them.** `worktreeBaseRef` and `worktreeStartFromOrigin` stay immutable birth provenance, because Turn checkpoints anchor to them (ADR 0011) and overwriting them would strand historical Turn diffs.

**5. No `.git` watcher, no polling.** State changes when we change it, and we already know when that happens. Polling costs work while idle, is still stale while busy, and guarantees nothing at any given instant. A watcher is the only way to catch changes we did not make — see Known limitation for why that is deferred rather than dismissed.

**6. A session whose worktree has vanished must not silently run in the primary checkout.** Today `session-manager.ts` guards with `existsSync(worktreePath)` and falls through to the project path, so a session whose worktree was removed quietly starts running the agent in the user's real checkout — losing exactly the isolation worktree mode exists to provide, without a word. The send is blocked with a message offering to recreate the worktree or switch to local mode.

## Known limitation, accepted deliberately

**Git changes that OpenWaggle did not make are not observed.** If the agent runs `git checkout -b`, `git worktree add` or `git stash` inside its worktree — or you switch branches in a terminal — OpenWaggle will not know until something else triggers a refresh for that working path.

This is recorded as a limitation rather than left implied, because it contradicts a reasonable expectation: that a session follows the branch the agent navigated to. It does not. A future reader should see that this was chosen, not overlooked.

Two options remain available, in increasing cost, if it becomes a real annoyance:

1. **Refresh once per turn** — a single call beside the existing `captureTurnCheckpoint`, which already runs after every turn in both run paths. Catches everything the agent did during a turn, at turn granularity, with no new machinery. This is the cheap answer to "follow the agent" and requires no watcher.
2. **A debounced `.git` watcher.** One recursive watch root per project suffices, because every linked worktree's `HEAD`, `index` and metadata live under the primary repository's `.git/worktrees/<name>/` (verified against this repository's own worktrees). This is the only option that also catches changes made entirely outside the app. Debouncing is mandatory rather than an optimisation: `.git` churns hard during any operation, and `index.lock` create/delete alone fires several events per `git add`.

Neither is in scope here.

## Consequences

- The diff panel starts showing the agent's actual work in worktree mode. Today it shows nothing.
- **Stage / Revert / Commit change target** — they will act on the session's worktree rather than the primary checkout. This is the intended fix, but it is a behavioural change to destructive actions and must be evident in the UI, not silent.
- The store shape changes from one slot to a map; `statusProjectPath` (an existing stale-guard) generalises into the map key.
- Sessions in `local` mode share one working tree, so they share fate: an agent that switches branch there moves the ground under every other local-mode session on that project. Nothing here prevents that; it is inherent to sharing a checkout, and the mitigation is preferring worktree mode.

## Terminology impact

CONTEXT.md defined a **Session worktree** as "a dedicated git worktree *plus its temporary git branch*" with a base ref "*frozen* once the worktree exists". OpenWaggle owns the worktree and records the branch it sets; a branch changed underneath it is simply not tracked (see Known limitation). "Frozen" applies to the **Worktree base ref** as birth provenance, not as a claim about which branch is checked out now. **Working path** names the per-session distinction the codebase previously lacked a word for.

## Staging

1. Working-path resolver + map-keyed git store; every renderer git read/write routed through the resolver.
2. Path-scoped invalidation and broadcast on all OpenWaggle-initiated git mutations.
3. The missing-worktree send guard (decision 6).
4. Per-session indicators in the session tree (the reason for the map).

## Alternatives considered

**Require the agent to declare its changes** (bespoke tools, or a post-turn report). Rejected: it fails the constraint that the agent must not have to remember anything, and it breaks silently the moment the agent reaches for plain `git`.

**Keep project-keyed state and rely on Turn diffs for worktree sessions.** Rejected: it abandons the review surface in the mode we ask people to use, and leaves two of three diff scopes meaningless.

**Show a project view and a session view side by side.** Rejected: it doubles the UI to expose a distinction most users should not have to think about.

**Observe everything with a watcher from the start.** Deferred, not dismissed — see Known limitation. The value is real but narrow (mid-turn freshness, and changes made outside the app), and the cost is a debounced recursive watch per project. Better paid for by a concrete annoyance than by a guess.
