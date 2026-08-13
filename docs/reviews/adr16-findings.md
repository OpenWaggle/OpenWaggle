# ADR 0016 — independent review findings and disposition

Three independent reviewers on scoped briefs against commits `e4b06d73..HEAD`. Raw reports: [reviewer 1](./adr16-reviewer-1.md) (main process), [reviewer 2](./adr16-reviewer-2.md) (renderer), [reviewer 3](./adr16-reviewer-3.md) (sidebar, tests, ADR accuracy).

Totals: **2 BLOCKER, 7 MAJOR, 5 MINOR.** They found two defects that both my own testing and my real-Electron QA had missed.

## BLOCKER — fixed

### A vanished worktree could never be recreated
`src/main/adapters/git/worktree.ts` · reviewer 1

`worktree prune` clears a stale worktree *registration* but not its branch. So when a worktree directory disappeared out-of-band, `git worktree add -b ow/session-<id>` failed with `fatal: a branch named ... already exists`, birth threw, and that session could **never run again**.

This directly falsified ADR 0016 decision 6 ("given a replacement, never the primary checkout") — the replacement path was a dead end. My task-3 test had missed it because it mocked `createGitWorktree` as succeeding.

Reproduced in a scratch repository before fixing: create worktree, `rm -rf` it, `worktree prune`, retry → `fatal: a branch named 'ow/session-abc' already exists`.

Fixed by probing `show-ref --verify --quiet refs/heads/<branch>` and attaching to the surviving branch (`worktree add <path> <branch>`) instead of creating one. **Attach rather than delete-and-recreate**, because the branch may carry commits the agent already made and discarding them for a clean slate would be silent data loss. Proven: reverting to unconditional `-b` fails the new test.

### Commit wrote to the wrong working tree
`src/renderer/src/shell/Header.tsx` · reviewer 2

`handleCommitGit` passed `useProject().projectPath`, so committing while a worktree session was active wrote to the **primary checkout** — a destructive action on a tree the user never reviewed.

My QA verified `Stage all` and concluded criterion 3 was satisfied. It only ever exercised one of the three mutations. Commit and the branch mutations were untested and unrouted.

Fixed to use `workingPath` from `useGit()`; the Header test now asserts the working tree, not the project.

## MAJOR — fixed

| Finding | Fix |
| --- | --- |
| Manual refresh in the Header loaded the project's status (reviewer 2) | Uses `workingPath` for status, `repositoryPath` for branches |
| `createBranch` from the action dialog targeted the project (reviewer 2) | Targets `git.workingPath` |
| `checkoutBranch` from the branch picker targeted the project (reviewer 2) | Targets `git.workingPath` |
| `loadSessionsWithArchivedBranches` did not select `environment_mode`/`worktree_path` while typed as `SessionSummaryRow`, so every archived-list session read as local mode (reviewer 1) | Columns added |
| `session-tree.ts` `loadSessionRows` had the same latent gap (reviewer 1) | Columns added |
| Test `actions()` mock did not match `SidebarSessionActions`, passing only because renderer tests run with `noCheck` — the component received `undefined` for every callback (reviewer 3) | Uses the real interface, typed |
| ADR staging step 1 claimed "every renderer git read/write routed through the resolver" while Header commit and composer branch mutations were not (reviewer 2) | The claim is now true, because those callers were routed |

## MINOR — fixed

- **Background sessions' indicators never refreshed** (reviewer 3). `useGitRefresh` only handles the active session's path, so a background session's badge stayed at its first value until the list rebuilt — which defeats the purpose of per-session state. `useSessionGitIndicators` now subscribes to `git:working-tree-changed` and re-reads any tracked path.

## Accepted without change, with reasons

- **Worktree birth does not invalidate the status cache** (reviewer 1, MAJOR). Reviewer offered documenting instead. `session-worktree-birth.ts` is a Pi adapter and must not import from `ipc/` where the cache lives, and the gap closes on its own: birth happens part-way through a send, and the renderer refreshes on the run's terminal event. A fresh worktree also has no stale entry. Documented at the call site.
- **Case-insensitive path matching in `isSameWorkingTree`** (reviewer 1, MINOR). `/Repo` and `/repo` are not treated as the same tree on macOS. Over-invalidation is the safe direction and under-invalidation here would need a user to type a differently-cased path into settings; not worth case-folding logic that would be wrong on case-sensitive volumes.
- **`broadcastToWindows` is untyped** (reviewer 1, MINOR). Pre-existing across all broadcast call sites; typing it is a separate change, not this ADR's scope.
- **Effect re-fetches all paths when the session set changes** (reviewer 3, MINOR). Reviewer's own assessment: not a correctness bug, negligible below ~15 sessions, and bounded by the 2s main-process cache plus per-path stale guards. Accepted rather than adding eviction complexity for an unmeasured cost.
- **ADR staging wording for step 2** (reviewer 1, MINOR). Cosmetic.

## Validation after the fixes

`pnpm check` exit 0 · typecheck 0 errors · lint clean · unit **2062** · component **528** · integration **124** · React Doctor **100/100**.

## What this round says about the earlier verification

Both BLOCKERs were in code paths my own tests and my real-Electron QA had touched but not exercised: I verified `Stage all` and inferred Commit, and I tested worktree recreation with a mock that could not fail. The reviewers' value here was not style — it was finding two ways to lose or misplace a user's work.
