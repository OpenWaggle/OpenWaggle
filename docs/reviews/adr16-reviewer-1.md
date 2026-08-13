load<'git:working-tree-changed'> which resolves to { workingPath: string
}.

────────────────────────────────────────────────────────────────────────────────

Here is my review:

Review Summary

### 1. src/main/ipc/git/status-cache.ts — isSameWorkingTree and invalidation

CLEAN. The prefix-matching logic is sound for the intended use case:
- /repo vs /repos: correctly rejects (requires trailing / in prefix check)
- Trailing slashes: normalized away
- Windows separators: \\ → / normalization
- Iteration safety: keys are spread into a new array before the loop; the second loop
  iterates a Set and only mutates Maps — safe
- Over-invalidation direction is explicitly documented as safe (wasteful but correct)

MINOR | src/main/ipc/git/status-cache.ts:56 | Case-insensitive filesystem paths are
not normalized | On macOS (case-insensitive APFS default), /Users/Foo/repo and
/users/foo/repo addressing the same tree would NOT match, causing a missed
invalidation. | In practice paths come from one source (Electron/Node APIs) so casing
is consistent. No fix needed unless observed in the wild; document the assumption.

### 2. Broadcast coverage — git mutations

MAJOR | src/main/adapters/pi/agent-kernel/session-worktree-birth.ts:65 | Worktree
birth bypasses invalidation | ensureSessionWorktreeProjectPath calls
createGitWorktree (the adapter, not the IPC handler) but never calls
invalidateGitStatusCache. The ADR lists "worktree birth" as a mutation that must
invalidate. The new worktree has no stale cache entry, so the immediate UX impact is
nil — but the project path's worktree list is now stale, and the renderer has no
signal to re-fetch it. If the sidebar shows per-session indicators, a newly birthed
session's state won't appear until the next turn-boundary or focus event. | Add
invalidateGitStatusCache(worktreePath) after the setSessionWorktree call, or accept
the gap is covered by the turn-boundary refresh that fires moments later (document
this choice).

All other mutation paths are covered:
- commit-handler.ts ✓ (invalidates on result.ok)
- working-tree-handler.ts (stage-all, revert-all) ✓
- branches-handler.ts (checkout, create) ✓
- worktree-handler.ts (create, remove — both sides) ✓
- stacked-action-handler.ts ✓

### 3. Session hydration — SELECT completeness

MAJOR | src/main/store/sessions/session-list.ts:117-128 |
loadSessionsWithArchivedBranches does not SELECT environment_mode or worktree_path |
The query is typed as sql<SessionSummaryRow> whose interface now declares those
fields (added in this PR). At runtime, SQLite returns undefined for unselected
columns. hydrateSessionSummary then produces environmentMode: 'local' and
worktreePath: undefined for every row — a worktree session in the archived-branches
list always looks like local mode. | Add environment_mode, worktree_path to the
SELECT in loadSessionsWithArchivedBranches.

MAJOR | src/main/store/sessions/session-tree.ts:71-82 | loadSessionRows (session-tree
detail query) does not SELECT environment_mode or worktree_path | Same pattern: typed
as SessionSummaryRow, but query omits the columns. Any future consumer that reads
sessionTree.session.environmentMode would silently get 'local'. Currently the
renderer doesn't use those fields from the tree path, but the type system can't
enforce that — calling code will assume a valid SessionSummary. | Add the two columns
to the SELECT to close the latent type/data integrity gap.

### 4. Dead code from the session-details revert

CLEAN. git diff e4b06d73~1..HEAD -- src/main/store/session-details/ shows zero
changes. The revert described in commit 4ed84b77 was complete — no remnants.

### 5. session-worktree-birth.ts — branch collision on recreation

BLOCKER | src/main/adapters/pi/agent-kernel/session-worktree-birth.ts:63-68 |
Vanished worktree recreation fails when the branch ref persists | When a worktree
directory is deleted out-of-band (rm -rf, disk wipe, different machine) the branch
ow/session-<8chars> remains in .git/refs/heads/. createGitWorktree runs worktree
prune (removes the stale worktree registration) then git worktree add -b
ow/session-<id> ... — which fails with fatal: a branch named 'ow/session-...' already
exists → classified as { ok: false, code: 'branch-exists' } → birth throws → session
is permanently broken until the user manually deletes the branch. The ADR's decision
6 ("given a replacement, never the primary checkout") becomes a dead end. | Before
the createGitWorktree call, check if the branch already exists and either: (a) reuse
it with git worktree add <path> <existing-branch> (no -b), or (b) delete it with git
branch -D then create fresh. Option (a) preserves history the user might have pushed;
option (b) guarantees a clean slate from baseRef.

### Additional observations

MINOR | src/main/ipc/git/status-cache.ts:2 | broadcastToWindows is untyped (channel:
string) | A typo in the event name or payload shape won't be caught at compile time.
This is pre-existing, not introduced here, but the new event is the first consumer
that matters semantically (stale UI on typo). | Consider a typed broadcast helper
parameterized on IpcEventChannelMap (deferred; not a blocker for this PR).

MINOR | ADR docs/adr/0016-session-keyed-git-state.md | "Staging" section lists step 2
as "Path-scoped invalidation and broadcast on all OpenWaggle-initiated git mutations"
— worktree birth is not fully covered (see MAJOR above). The ADR should either
acknowledge the gap or be updated once fixed. | Update ADR after addressing the birth
invalidation gap.

────────────────────────────────────────────────────────────────────────────────

┌──────────────┬────────────────────────────────────────────────────────────────────┐
│ Category     │ Verdict                                                            │
├──────────────┼────────────────────────────────────────────────────────────────────┤
│ Correctness  │ 1 BLOCKER (branch collision on recreation), 3 MAJOR (missing       │
│              │ invalidation on birth, 2 incomplete SELECTs)                       │
├──────────────┼────────────────────────────────────────────────────────────────────┤
│ Architecture │ Clean — no hexagonal violations, no ipc/ cross-imports             │
├──────────────┼────────────────────────────────────────────────────────────────────┤
│ Dead code    │ Clean — revert was complete                                        │
├──────────────┼────────────────────────────────────────────────────────────────────┤
│ Type safety  │ Sound end-to-end for the new IPC event; latent gap from unselected │
│              │ columns                                                            │
├──────────────┼────────────────────────────────────────────────────────────────────┤
│ Tests        │ Cover the happy paths well; missing: recreation when branch        │
│              │ already exists                                                     │
└──────────────┴────────────────────────────────────────────────────────────────────┘
