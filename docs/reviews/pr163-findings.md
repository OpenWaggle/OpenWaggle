# PR #163 review rounds — findings and dispositions

Three independent review rounds examined this branch. Round one raised 40 findings, round two 36, and
round three 30. Rounds two and three each found defects in the *previous* round's fixes, which is the
main reason this record exists: the fix for a finding is itself new code, and it needs the same
scepticism as the code it replaced.

Every finding below was verified against the actual code — usually against real git — before being
acted on. Fixes carry a regression test that was demonstrated to fail when the fix is reverted.

## Rounds one and two: all findings resolved

- **Round one (40):** worktree birth running twice per send and session branches colliding within a
  ~65-second UUIDv7 bucket were the two criticals. The rest covered orphaned dirty worktrees, leaked
  turn-checkpoint refs, diffs that threw instead of returning typed failures, a fail-open confirmation
  gate, `git add --all` sweeping the whole repository, and a documented-but-unenforced adapters→IPC
  boundary.
- **Round two (36):** commit dispatching with zero paths because the panel depended on a store it never
  populated; commit failing outright in any repository opened at a subdirectory; change-request adoption
  fetching a ref that does not exist for a fork; an evil merge smuggling an unreleased `packages/**`
  change past Commit Policy; the NSIS hook table compiled in the wrong pass; the Turn scope showing the
  previous turn's diff.

## Round three

Resolved:

| Finding | Substance |
| --- | --- |
| T1-1 | `core.quotePath` made every commit fail if any working-tree path needed quoting |
| T1-2 | The adopted change-request ref lived where a pruning fetch deletes it |
| T1-3 | A foreign directory at the worktree path blocked the session with no way out |
| T1-4 | The "network-free" local status was reaching the network |
| T1-5 | Archiving deleted the worktree's ignored files (`.env`, `node_modules`) |
| T1-6 | The change-request fetch was unbounded |
| T1-7 | A file whose name contains ` -> ` was mangled into a rename |
| T1-8 | A timed-out git command reported no reason |
| T2-1 | The Turn scope had no loading state |
| T2-2 | "Try again" on a failed turn diff ran a working-tree diff |
| T2-3, T2-11 | Review restore could duplicate a comment and dropped the submitted summary |
| T2-4 | A review written before the session existed was orphaned on creation |
| T2-5, T2-9 | `loaded` described another repository's branch list |
| T2-6 | Overlapping status loads had no ordering |
| T2-7 | A failed `git status` was reported as "no changes to commit" |
| T3-1 | Two NSIS hooks were compile-checked in one pass only |
| T3-3 | The merge exemption was evadable by reverting a published file to an older release |
| T3-5 | The SQL projection rule exempted anything starting with an aggregate |
| T3-6 | The renderer typecheck could be silenced by relaxing strictness |
| T3-7 | The installer config reader rejected valid YAML and advised deleting the check |
| T3-8 | The timeout test relied on an IP address black-holing packets |

Not fixed, with reasons:

- **T2-8, T1-9 (missing test coverage).** Both are covered by tests added for the findings they
  accompany: the rename expansion by `rename-paths.unit.test.ts` and `commit-subdirectory.integration.test.ts`,
  the root-relative commit by the latter. No further test was added for its own sake.
- **T2-10 (label flicker while a diff reloads).** Correct as reported, and deliberate: the Automatic
  reporting is reset when a load starts precisely so the header cannot claim something the pending diff
  has not yet established. A flicker is the visible cost of not lying; smoothing it would reintroduce
  the stale claim that T2-11's sibling finding objected to.
- **T2-12 (a dirty submodule produces a commit set git refuses).** Real. The dialog promises "1 changed
  file" and main answers "no changes available to commit". Not fixed here because the honest fix is to
  decide what committing a submodule pointer *should* mean for this panel, which is a design question
  rather than a defect in this branch's changes.
- **T2-13 (three send paths still bypass the composer gate).** Real and narrower than it sounds: the
  dispatch failure now surfaces the actionable recover-or-switch message instead of the generic queue
  toast, so the user is told what to do. Routing starter prompts, palette sends and steering through the
  gate means moving it out of the composer, which is a restructuring this branch should not carry.
- **T3-2 (`PASS_BY_TEMPLATE` keyed by file basename).** Accepted risk, bounded: if electron-builder
  renames a template, the derivation loses that file's pass information and falls back to "both passes",
  which over-checks rather than under-checks. The unit test asserts placements against the shipped
  templates, so a rename that changed the answer would fail there.
- **T3-4.** Obsolete: it described `evilMergePaths`, which no longer exists — the exemption now compares
  blobs against the base, and the paths it reads already come from a `-z` read.

## Round four: verification

A fourth round was asked to verify the round-three fixes rather than hunt afresh. It found 26 issues, of
which four mattered a great deal — and one that says more than the rest: all three reviewers independently
reported an empty `name.txt` committed at the repository root. A shell probe had created it (`echo x >
"weird -> name.txt"` splits on the unquoted `>`) and `git add -A` swept it in. Removed in `6c4ce8c1`.

Resolved:

| Finding | Substance |
| --- | --- |
| V1-1 | A merge reverting a released package file escaped release intent entirely |
| V1-2, V3-3, V3-4 | The path-quoting fix missed the numstat fallback and every `diff --patch` reader |
| V1-3, V1-6 | Numstat rename parsing, including the form that removes a path component |
| V1-4 | `networkGitOptions` was used by two callers; push, pull and the status fetch were unbounded |
| V1-5 | The *recorded* worktree path was still adopted on existence alone |
| V1-9 | A rationale listing callers that no longer reach the code |
| V2-1 | The review migration claimed another session's pending review |
| V2-2 | A review submitted as a session's first message was destroyed on failure |
| V2-3 | "Try again" on a failed turn diff had become inert |
| V2-4 | A working tree not yet read was reported as clean |
| V2-5 | The commit dialog counted a rename as two files |
| V2-6 | A comment claimed a comparison the code does not make — the claim was corrected, not the code |
| V3-1 | Templates were located by taking the first glob hit in the pnpm store |
| V3-2 | The installer config reader could not read a CRLF file |
| V3-5 | The exemption refused a sync merge carrying a package deletion |
| V3-6 | `app-settings.md` still named the legacy session branch |
| V3-8 | Comment stripping truncated code inside a multi-line template literal |

Not fixed, with reasons:

- **V1-7 (paths git escapes regardless of `core.quotePath`).** A newline in a filename is still reported
  escaped, because git has no unescaped porcelain v1 form for it. Handling it means moving to `-z` parsing
  throughout, which is a larger change than this branch should carry; `core.quotePath=false` covers every
  path that is merely non-ASCII, which is the case users actually hit.
- **V1-8 (four fixes without their own test), V2-8.** Each is covered by a test written for the finding it
  accompanies; no test was added purely to raise a count. `timedOut` is carried but not yet read by a caller,
  which is deliberate — it exists so a caller *can* distinguish a kill from a failure.
- **V1-10, V2-8, V3-7 (the stray `name.txt`).** Fixed: the file is gone.
- **V3-2's sibling YAML forms (anchors, aliases).** Not handled, and reported as such rather than guessed at:
  an anchor would need a YAML parser, and adding one to a guard script buys less than it costs.

## Round five: sign-off

A fifth round was asked a narrower question - is there anything here that would harm a user, lose their work,
or let a broken change reach `main`? It found five, three of them serious, and every one was a defect in a
*previous round's fix* rather than in the original branch. All five are resolved.

| Finding | Substance |
| --- | --- |
| W1-1 | A commit containing a rename or a deletion failed outright |
| W1-2 | The stacked path staged separately from `commitGit`, duplicating that logic badly |
| W2-1 | A review submitted as a session's first message was restored under a key nothing was reading |
| W2-2 | A `git status` that failed was still reported as a clean tree |
| W3-1 | Release intent was demanded of PRs that touch no package, once `main` moved ahead |

Two are worth recording in more detail, because both were introduced while fixing something else.

**W3-1** would have blocked every pull request on this repository the moment a release landed. The PR-level
release-intent check asked a two-dot `git diff` between the base branch tip and the PR head. That is
symmetric, so once `main` gained a `packages/` commit the branch had not merged, the diff reported that path
in the reverse direction and demanded release intent from a PR that never touched a package. Verified against
real git, then fixed by asking a three-dot diff against the merge base.

**W1-1** came from the fix for renames committing only one of their two paths. Including the rename's source
in the commit set is right - without it the commit keeps both files and leaves the deletion staged, which was
verified - but that path is gone from disk, and `git add -- <paths>` refuses a path it cannot match. For an
*already staged* rename the source is gone from the index too, so it matches nothing at all and batching
makes the failure fatal for the whole commit. Staging is now per-path with `-A`, and an unmatched entry is
skipped rather than failing the commit. The unit test that was supposed to cover this staging turned out to
be watching the duplicate `add` in the stacked path (W1-2) rather than `commitGit` at all: with the duplicate
removed it went red, which is how W1-2 was confirmed.

