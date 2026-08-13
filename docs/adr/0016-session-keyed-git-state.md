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

### The refresh trigger already exists

OpenWaggle already refreshes git state at the right moments, against the wrong path. `useGitRefresh` subscribes to agent events and, on a terminal transport event (`agent_end` with a reason other than `toolUse`, i.e. a turn finishing), debounces 500ms and then calls `refreshGitStatus` / `refreshGitBranches` and bumps `diffRefreshKey`, which remounts the diff panel through `ChatDiffPane`'s `key`. A window-focus listener does the same. Both pass **`projectPath`**.

So the trigger for "the agent changed something, go look" is built and correctly timed. What is broken is only the target it looks at.

## Decision

**1. Key status, diffs and working-tree mutations to the session's working path.** A renderer-side resolver mirrors `session-manager.ts`: the Session worktree path in `worktree` mode, otherwise the project path. Branch lists, worktree lists and remotes stay **project-keyed** — a linked worktree shares `refs/` with the primary checkout, so those are genuinely repository-level.

**2. Store git state as a map keyed by working path.** Per-session state coexists, which is what makes per-session indicators (dirty, ahead/behind) possible later. A single slot cannot represent two sessions on two worktrees.

**3. Route the existing refresh triggers through the working path, and invalidate per path.** `useGitRefresh` already fires on turn end and window focus; it must refresh the session's working path rather than the project path. Every git mutation we perform — commit, stage-all, revert-all, worktree create/remove, branch create/checkout, worktree birth — invalidates for the affected working path. Invalidation carries the working path rather than being a coarse "git changed" signal: coarse events fan out, making session A re-run a full `git diff` because session B's index changed, and diffs here carry an explicit `maxBuffer`. Invalidating rather than pushing computed state keeps the event schema decoupled from consumers and keeps large diff payloads off the IPC bus; it also reuses the existing `invalidateGitStatusCache` instead of introducing a parallel mechanism.

**4. Record the branch and worktree path we set, at the moment we set them.** `worktreeBaseRef` and `worktreeStartFromOrigin` stay immutable birth provenance, because Turn checkpoints anchor to them (ADR 0011) and overwriting them would strand historical Turn diffs.

**5. No `.git` watcher, no polling.** The existing turn-boundary and window-focus triggers cover the cases that matter once they point at the right path. Polling costs work while idle, is still stale while busy, and guarantees nothing at any instant. A watcher would close the two narrow gaps named in Known limitation — see there for why it is deferred rather than dismissed.

**6. A session whose worktree has vanished is given a replacement, never the primary checkout.** This property already held and is now pinned by a test: `ensureSessionWorktreeProjectPath` runs on both run paths and, when the recorded `worktreePath` no longer exists, creates a fresh worktree rather than resolving to the opened checkout. Falling back would silently drop the isolation worktree mode exists to provide.

An earlier draft of this ADR claimed the opposite — that a vanished worktree "quietly starts running the agent in the user's real checkout" — and proposed blocking the send. That was wrong: it read `resolveSessionProjectPath`'s `existsSync` fallback in isolation, without noticing that the run paths call it only to obtain the *repository* to fork from, and then create a worktree. Blocking would have replaced working auto-recovery with a dead end. What was genuinely missing is that the replacement happened **silently**, since the new worktree does not contain whatever the old one held; that is now logged.

## Known limitation, accepted deliberately

**Changes are picked up at turn boundaries and on window focus, not continuously.** `useGitRefresh` already fires on `agent_end` and on window focus, so agent-initiated work — including `git checkout -b` or `git stash` inside the worktree — is reflected shortly after the turn that made it, once that refresh is routed through the working-path resolver. What is *not* covered:

- **Mid-turn changes.** A ten-minute turn that branches at minute two shows nothing until it ends.
- **Changes made while the window is unfocused and no turn is running** — for example switching branches in a terminal. Focusing the window resolves it.

A debounced `.git` watcher would close both gaps. One recursive watch root per project suffices, because every linked worktree's `HEAD`, `index` and metadata live under the primary repository's `.git/worktrees/<name>/` (verified against this repository's own worktrees). Debouncing would be mandatory rather than an optimisation: `.git` churns hard during any operation, and `index.lock` create/delete alone fires several events per `git add`.

Deferred: the remaining gaps are narrow, and the existing turn-boundary refresh already covers the case that motivated this work — seeing what the agent just did.

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
3. Pin the vanished-worktree property with a test and surface the replacement (decision 6).
4. Per-session indicators in the session tree (the reason for the map).

## Alternatives considered

**Require the agent to declare its changes** (bespoke tools, or a post-turn report). Rejected: it fails the constraint that the agent must not have to remember anything, and it breaks silently the moment the agent reaches for plain `git`.

**Keep project-keyed state and rely on Turn diffs for worktree sessions.** Rejected: it abandons the review surface in the mode we ask people to use, and leaves two of three diff scopes meaningless.

**Show a project view and a session view side by side.** Rejected: it doubles the UI to expose a distinction most users should not have to think about.

**Observe everything with a watcher from the start.** Deferred, not dismissed — see Known limitation. The value is real but narrow (mid-turn freshness, and changes made outside the app), and the cost is a debounced recursive watch per project. Better paid for by a concrete annoyance than by a guess.
