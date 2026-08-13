# Session-Keyed Git State

Status: accepted (not yet implemented — see Staging)

OpenWaggle keys its git surface to the **working path** of the active session — the Session worktree in worktree mode, the opened checkout in local mode — and refreshes it when OpenWaggle itself changes git state. This matches T3Code's model deliberately and closely.

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

### What T3Code does, verified in its source

| Concern | T3Code |
| --- | --- |
| Status transport | server-push subscription `subscribeVcsStatus`, keyed by **`cwd`** |
| Status keyed per working tree | **yes** — atom family per `(environmentId, cwd)` |
| `.git` watcher | **none** |
| Status polling | **none** (only an `automaticRemoteRefreshInterval` for *remote* ahead/behind) |
| Refresh triggers | only self-initiated operations: `createWorktree`, `removeWorktree`, `createRef`, `switchRef`, worktree bootstrap, auto branch-rename (`ws.ts:937`, `1598`, `1773`–`1842`) |
| Refresh after an agent turn | **no** |
| Stored thread branch / worktree | updated via `thread.meta.update` when *they* change it (`ws.ts:930`–`937`, `ProviderCommandReactor:771`–`778`) |

The decisive point: **T3Code does not observe agent-initiated git changes.** If its agent runs `git checkout -b` through a shell tool, its UI is as stale as ours. What it gets right is that status is keyed by `cwd`, so the UI is always pointed at the correct working tree — which is precisely OpenWaggle's defect.

## Decision

**1. Key status, diffs and working-tree mutations to the session's working path.** A renderer-side resolver mirrors `session-manager.ts`: the Session worktree path in `worktree` mode, otherwise the project path. Branch lists, worktree lists and remotes stay **project-keyed** — a linked worktree shares `refs/` with the primary checkout, so those are genuinely repository-level.

**2. Store git state as a map keyed by working path.** Per-session state coexists, which is what makes per-session indicators (dirty, ahead/behind) possible later. A single slot cannot represent two sessions on two worktrees. This mirrors T3Code's atom-family-per-`cwd`.

**3. Refresh on OpenWaggle-initiated git changes, and push the invalidation.** Every git mutation we perform — commit, stage-all, revert-all, worktree create/remove, branch create/checkout, worktree birth — invalidates and broadcasts for the affected working path. The watcher becomes a third caller of the existing `invalidateGitStatusCache` rather than a parallel mechanism. Events are **path-scoped**, not coarse: a coarse `git:changed` would make session A re-run a full `git diff` because session B's index changed, and diffs here carry an explicit `maxBuffer`.

**4. Record the branch and worktree path we set, when we set them.** Mirrors `thread.meta.update`. `worktreeBaseRef` and `worktreeStartFromOrigin` stay immutable birth provenance, because Turn checkpoints anchor to them (ADR 0011) and overwriting them would strand historical Turn diffs.

**5. No `.git` watcher, no polling.** Explicitly rejected for parity — see Known limitation.

**6. A session whose worktree has vanished must not silently run in the primary checkout.** This one goes beyond parity, on safety grounds. Today `session-manager.ts` guards with `existsSync(worktreePath)` and falls through to the project path, so a session whose worktree was removed quietly starts running the agent in the user's real checkout — losing exactly the isolation worktree mode exists to provide, without a word. The send is blocked with a clear message offering to recreate the worktree or switch to local mode.

## Known limitation, accepted deliberately

**Agent-initiated git changes are not observed.** If the agent runs `git checkout -b`, `git worktree add` or `git stash` inside its worktree, OpenWaggle will not know until something else triggers a refresh for that working path.

This is T3Code's behaviour and is accepted for parity. It is recorded here because it directly contradicts a reasonable expectation — that the session "follows the branch the agent navigated to" — and a future reader should know it was a decision, not an oversight.

Two cheaper-than-a-watcher options remain available if this becomes a real annoyance:

1. **Per-turn refresh** — one call beside the existing `captureTurnCheckpoint`, which already runs after every turn in both run paths. Catches everything the agent did, at turn granularity, with no new machinery.
2. **A debounced `.git` watcher.** One recursive watch root per project suffices, because every linked worktree's `HEAD`, `index` and metadata live under the primary repository's `.git/worktrees/<name>/` (verified against this repository's own worktrees). That also catches changes made outside the app entirely.

Neither is in scope here.

## Consequences

- The diff panel starts showing the agent's actual work in worktree mode. Today it shows nothing.
- **Stage / Revert / Commit change target** — they will act on the session's worktree rather than the primary checkout. This is the intended fix, but it is a behavioural change to destructive actions and must be evident in the UI, not silent.
- The store shape changes from one slot to a map; `statusProjectPath` (an existing stale-guard) generalises into the map key.
- Sessions in `local` mode share one working tree, so they share fate: an agent that switches branch there moves the ground under every other local-mode session on that project. Nothing here prevents that; it is inherent to sharing a checkout, and the mitigation is preferring worktree mode.

## Terminology impact

CONTEXT.md defined a **Session worktree** as "a dedicated git worktree *plus its temporary git branch*" with a base ref "*frozen* once the worktree exists". OpenWaggle owns the worktree and records the branch it sets; a branch the agent changes underneath is simply not tracked (see Known limitation). "Frozen" applies to the **Worktree base ref** as birth provenance, not as a claim about which branch is checked out now. **Working path** names the per-session distinction the codebase previously lacked a word for.

## Staging

1. Working-path resolver + map-keyed git store; every renderer git read/write routed through the resolver.
2. Path-scoped invalidation and broadcast on all OpenWaggle-initiated git mutations.
3. The missing-worktree send guard (decision 6).
4. Per-session indicators in the session tree (the reason for the map).

## Alternatives considered

**Require the agent to declare its changes** (bespoke tools, or a post-turn report). Rejected: it fails the constraint that the agent must not have to remember anything, and it breaks silently whenever the agent reaches for plain `git`.

**Keep project-keyed state and rely on Turn diffs for worktree sessions.** Rejected: it abandons the review surface in the mode we ask people to use, and leaves two of three diff scopes meaningless.

**Show a project view and a session view side by side.** Rejected: it doubles the UI to expose a distinction most users should not have to think about.

**Polling.** Rejected: cost while idle, staleness while busy, and no guarantee at any instant. T3Code does not poll status either.

**`.git` watcher.** Deferred, not dismissed — see Known limitation.
