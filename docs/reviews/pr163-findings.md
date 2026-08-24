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

## Round six: the repairs of the repairs

The sixth round was pointed at round five's five repairs. It found six more, three of them serious, and every
one was again a flaw in a fix rather than in the original branch. All six are resolved.

| Finding | Substance |
| --- | --- |
| X1-1 | The header's Commit dialog committed a rename as a duplicated file |
| X1-2 | Commit from the header dialog was still dead in a repository opened at a subdirectory |
| X1-3 | A filename containing glob syntax committed an unselected sibling |
| X2-1 | The failed-send restore followed *any* key change, moving a review into another diff or session |
| X2-2 | A review the agent had received was offered back for a second submission |
| X3-1 | A synced PR was permanently blocked once the base released the same file again |

The first three share one cause and now share one fix. There is more than one way into a commit - the diff
panel's stacked action and the header's Commit dialog - and each had a different subset right, so everything a
correct commit needs is now settled inside `commitGit`: the repository root, the rename sources read from the
working tree, and `--literal-pathspecs`. A caller passing target paths only, from a subdirectory, with a
filename like `file[ab].txt`, now commits exactly what was selected. Each of the three is pinned by reverting
it in turn.

X2-1 is the sharper lesson. Round five's repair made the restore "follow the panel", but "the key changed" is
also true for a scope tab, a base ref, a turn, a session switch and a project switch - and following those
*moves* the thread, so comments anchored in one diff would sit pending in another, or one session's review in
another session's conversation. That is precisely what keying reviews was introduced to prevent, so the repair
had reopened the original bug by a different route. Only one transition is legitimate, the same working tree
and scope gaining a session id, which is exactly the transition in which the draft key does not move.

X2-2 was a wrong assumption rather than a wrong line: sending a message and running the agent turn are one
promise to callers, so a provider error or a rate limit rejects it long after the review has reached the
transcript. `MessageDeliveredRunFailed` now distinguishes them.

X3-1 would have blocked this very pull request. The sync-merge exemption compared the merge's blobs against
the base *tip*, which moves: a merge that legitimately brought release 0.2.0 stopped matching the moment the
base released 0.3.0 of the same file - every release, since release-please rewrites `package.json` and
`CHANGELOG.md` each time - and the resulting commit-level violation cannot be satisfied by any PR title.
A merge's own parents cannot move, so they are asked as well. This does not weaken the evil-merge guard: an
evil merge introduces content matching no parent, which is what makes it evil.

## Round seven

Round seven checked round six's four repairs and found seven more issues, three of them serious. Its
release-intent reviewer returned zero findings and a clear recommendation to merge. All seven are resolved.

| Finding | Substance |
| --- | --- |
| Y1-1 | A new file left where a rename started was committed, unselected |
| Y1-2 | A copy's source was treated like a rename's |
| Y1-3 | A directory where a rename started broke the commit and staged unselected files |
| Y2-1 | "Delivered" was inferred from the invoke resolving, which is not evidence |
| Y2-2 | The first-send path read main's failure as success |
| Y2-3 | The follow rule refused the transition it was written for |
| Y2-4 | The follow rule could file a review into a different session |

Three of these deserve recording, because each was a *premise* that turned out to be false rather than a
mistaken line.

**The rename source is not always absent.** Adding it to the commit covers the deletion, which is right, but
`git commit -- <paths>` commits the *working tree* content of the paths it is given. A user who creates
something new at the old name - or a directory - would have had that committed without selecting it, and
staging it first also destroyed the rename record in the index. Both verified against real git. When the path
is occupied there is no deletion left to express, so the honest commit is the target alone. That same check
settles copies, whose sources are never deleted.

**A resolved send is not a delivered message.** Repair 3 rested on the premise that `await sendPromise`
resolving meant the agent had the message. Main recovers every run failure into a value rather than failing
the Effect, so the invoke resolves whether the turn ran or was refused - and the missing-worktree refusal,
the exact case the review restore exists for, resolves like a success. The premise was not just imprecise, it
was false for precisely the failure that mattered, so the repair had broken what it was protecting. Two
things now carry real information: `agent:send-message` and its waggle counterpart return an
`AgentSendReport`, so no caller can read a refusal as success; and delivery is judged by the agent reporting
the turn started, which is the only positive evidence the renderer has. Absent that evidence the failure is
reported as undelivered, which is the side that keeps the user's work.

**The draft key does move.** Repair 2 narrowed the review-follow rule to "the same working tree and scope
gaining a session id", on the stated grounds that the draft key does not move in that transition. It does: the
scope selection is itself keyed by the session, and a brand-new session has none recorded, so a review written
in the Branch scope had its follow refused and was orphaned. The rule also never checked *which* session
appeared, and in local mode every session of a project shares one working path. Both are gone: a failed first
send now names the session it created, and the panel builds the target key from that id and the scope the
review was written in. Nothing is inferred.

## Round eight

Round eight attacked round seven's four repairs and found seven issues. All are resolved.

| Finding | Substance |
| --- | --- |
| Z1-1 | A broken symlink at a rename source was committed, unselected |
| Z1-2 | A case-only rename failed the commit with a raw git fatal |
| Z2-1 | `aborted` was reported as delivered, though a pre-prompt cancellation reports that outcome |
| Z2-2 | The ordinary send path never read the report it had been given |
| Z2-3, Z3-1, Z3-2 | A review written in a non-default scope was still orphaned on the success path |

Three points worth keeping.

**`stat` follows symlinks; the occupancy check must not.** A broken symlink is still something the user put
where the rename started, and `stat` reports it as absent - so the source was expanded into the commit and the
symlink committed without being selected. `lstat` asks the question that was actually meant.

**The report was added and then not consulted where it mattered most.** Round seven read `AgentSendReport` on
the first-send path but left the ordinary path - every message to an existing session, which is the normal case
for a review - awaiting the promise and discarding the value. That path also depends on the run promise
rejecting, and ordinary actions such as Stop settle it without an error. It now reads the report and falls back
to the delivery evidence. `aborted` no longer claims delivery either: a run cancelled before its prompt was
sent reports exactly that outcome, so it is not evidence in either direction, and the caller must assume the
message never arrived.

**The scope reset was the root cause, and it was fixed in the wrong place.** Round seven made a *failed* first
send carry the session it created, which fixed the failure path and left the ordinary one: a brand-new session
has no scope selection recorded, so the panel snapped back to the working-tree scope in the very render the
session appeared. A new session now inherits the scope its draft was written in, which both keeps the
reviewer's choice and makes the review key stable across the transition.

One limitation is recorded rather than fixed: a **case-only rename** cannot be committed through a pathspec on
a case-insensitive filesystem. (Round nine showed this disposition was incomplete - see below.) Git refuses with "will not add file alias", because a pathspec commit rebuilds
those entries from the working tree and finds the other spelling already in the index. Committing the whole
index does work, and `git commit -i` does too - but both sweep in whatever the user staged themselves, which is
the one guarantee this commit path exists to keep. Verified against real git. The failure is now reported as
`case-only-rename` with an actionable message instead of a raw fatal under `unknown`; committing it correctly
needs a different mechanism (`write-tree`/`commit-tree`) and belongs in its own change. This behaviour predates
the branch.

## Round nine

Round nine found four issues: one in the commit path and three that all trace to round eight's decision to
report an aborted run as undelivered. All are resolved.

| Finding | Substance |
| --- | --- |
| A1-1 | A case-only *directory* rename committed successfully while omitting the change |
| A2-1 | A superseded send's cancellation was raised as an error, dismantling the run that replaced it |
| A2-2 | Stop before the first turn event reported a failure the user had caused |
| A3-1 | Stop with a queued message restored a review the agent already had, and wedged the chat |

**Round eight's disposition was incomplete, and the shape it missed was worse than the one it recorded.** A
case-only difference in a *file name* is refused outright by git. A case-only difference in a *directory
component* is not: git's pathspec matching resolves the new spelling onto the old index entry, `add` and
`commit` both exit 0, the rename is left out of the commit while staying staged, and `commitGit` returned
`{ ok: true }` - so the stacked action would have pushed an incomplete commit. Both shapes are now detected up
front, and only where the filesystem actually conflates the two spellings: on a case-sensitive filesystem this
is an ordinary rename that commits perfectly well, and refusing it there would break something that works. The
tests ask the filesystem rather than assuming the platform, because development happens on case-insensitive
macOS while CI runs on case-sensitive Linux.

**A cancellation is not a failure, and the previous round made it one.** Reporting `aborted` as
`delivered: false` was right about the evidence - a run cancelled before its prompt was sent reports the same
outcome as one cancelled mid-turn - but the ordinary send path *throws* when a report is not delivered, and
that turned an everyday sequence into a broken one. Stopping settles the run, a queued follow-up send begins
immediately, and the superseded send's reply arrives after the replacement has started, by which time the
session-wide delivery evidence has been cleared by that replacement. The throw then dismantled the run that had
replaced it and left the chat wedged. The report now carries three outcomes rather than two - `delivered`,
`refused`, `cancelled` - because "did not arrive" and "cannot tell" call for different behaviour: only a
refusal is an error, while a cancellation still lets a caller keep work the user may want back.

## Round ten

Round ten found four issues, one of them a blocker, and its whole-branch reviewer said plainly: do not merge
until that one is fixed. All four are resolved.

| Finding | Substance |
| --- | --- |
| B1-1 | A directory case change *plus* a file rename still committed successfully with the change omitted |
| B1-2 | The case gate could refuse commits git performs happily on a case-sensitive filesystem |
| B2-1, B3-1 | A cancelled send lost the submitted review, or reported the user's own Stop as a failure |

**Not throwing was as wrong as throwing.** Round nine stopped raising a cancellation as an error, which fixed
the Stop flow and reintroduced the loss it had been guarding: `onSubmitReview` clears the review before awaiting
and restores it only on a failure, so a cancellation returning as an ordinary success left the work gone with
nothing to bring it back. And a cancellation before the prompt was sent means main recorded nothing at all - no
transcript entry, no turn-started event - so the message really was lost. The two requirements were never in
conflict, they were being served by one signal: the caller must be *told*, so it can keep the work, but the
session must be *left alone*, because the run that the failure path would tear down may be the replacement that
a queued send has already started. `MessageNotDelivered` now carries its outcome and is raised after the run
handling rather than inside it, and `isReportableSendFailure` decides separately whether the user hears about
it. A refusal is worth reporting; their own Stop is not.

**A rule about whole paths was not a rule about path components.** Comparing `from` against `to` in full only
fires when nothing but case changed, so changing a directory's case while also renaming the file left the
conflated directory component in place - the same silent omission, undetected. Any component now counts.

**And the gate for it was the wrong question.** "Something still sits at the source path" is not "this
filesystem conflates the spellings": on a case-sensitive filesystem a source is occupied for exactly the
ordinary reasons the occupancy check was added for - a new file, a directory, a broken symlink, a copy - each of
which would then have refused a commit git performs happily. The question is now put to git itself, which sets
`core.ignorecase` by probing the filesystem when the repository is created. The component rule is pinned by a
unit test with no filesystem involved, so it holds on the case-insensitive machines this is developed on and the
case-sensitive ones CI runs on.

## Round eleven

Round eleven's whole-branch reviewer said merge; the two focused reviewers found seven issues between them,
and every one pointed at the same thing: two designs of mine were reasoning by proxy instead of asking the
question. Both proxies are now gone, and with them the findings.

| Finding | Substance |
| --- | --- |
| C1-1, C1-2, C1-3 | The case-rename rule was wrong in both directions, and read a git boolean as a string |
| C2-1 | A first send whose turn ran and then failed restored a review the agent already held |
| C2-3, C2-4 | Session-keyed delivery evidence attributed one send's turn to another |
| C2-2, C3-1 | A cancelled first send reported the user's own Stop as a failure |

**Predicting which renames git cannot express was the wrong approach.** Three attempts each failed in one
direction or the other: comparing whole paths missed a directory case change that also renamed the file;
comparing components pairwise skipped the comparison whenever the depth changed, and fired on components git
conflates nothing about; and "something sits at the source path" was never the same question as "this filesystem
folds these spellings". The prediction is gone. The commit is now *verified*: the paths the index held before the
commit are compared against the paths the commit recorded, and if something asked for was not recorded, the
commit is undone with `--soft` - leaving the user's index and working tree exactly as they were - and reported.
No path-shape judgement is involved, so there is no direction left to be wrong in. One shape the earlier rules
refused turned out to commit perfectly well through the real path, verified against git, and is now pinned as
such.

**Guessing at delivery from stream events was also the wrong approach, and main knew the answer all along.**
`transportEmitted` already distinguishes a failure raised after the turn began from a refusal raised before it.
Reporting both as refusals is what made a review come back after the agent had it, and it is why the renderer
was keeping a session-keyed record of turn-start events - a record that cannot tell one send in a session from
the next, so a replacement's turn was attributed to the send it replaced. Main now reports `delivered` for a
run that reached the transport, and the renderer's bookkeeping is deleted rather than corrected.

## Round twelve

Round twelve found five issues in round eleven's two replacements, including one that would have stopped a new
project making its first commit. Four are fixed; one is recorded.

| Finding | Substance |
| --- | --- |
| D1-1, D3-1 | Every first commit in a repository was created, rolled back and reported as a failure |
| D1-2 | `--amend` was exempt from verification, so it could still omit a change silently |
| D2-1 | A rejected invoke was reported as delivered, destroying the submitted review |
| D2-3 | A failure while persisting the turn was reported as though the message never arrived |
| D2-2 | The waggle path cannot report a refusal - recorded below, not fixed |

**A root commit has no parent, and `git diff-tree HEAD` says nothing about it.** Verification read that silence
as a total omission, so the first commit in any repository was created, undone and reported as a failure -
verified against real git before and after. `--root` asks the question properly.

**Exempting `--amend` was an admission that the undo was wrong, not that amends were safe.** Stepping back one
parent is incorrect for a commit that replaced one rather than added one, so amends were left unverified and
free to omit silently. The undo now restores the *recorded* previous HEAD, which is correct for both, and
nothing is exempt.

**One `try` covered two very different awaits.** The catch wrapped every failure as "delivered, and then the
run failed", but it also covers the invoke itself rejecting - a payload the schema refuses, a handler that dies
- where nothing arrived at all. Delivery is now marked only when main's report says so.

**And `transportEmitted` marked less than it claimed.** It was set only when the kernel returned a terminal
error, while the work after the kernel returns - reading the tree, appending events, persisting the snapshot,
anchoring the checkpoint - can fail too, long after the agent has answered. Those failures were reported as
refusals, which is what makes a caller offer a review the agent already holds. The run now records that it
reached the agent, and the recovery marks the outcome accordingly.

Recorded rather than fixed: **the waggle path cannot report a refusal.** Its run has no equivalent of the
classic path's recovery, so a kernel failure - a missing worktree, a failed `worktree add` - fails the Effect
and rejects the invoke instead of being reported. With the delivery fix above a rejection is treated as
undelivered, so nothing is lost: the consequence is confined to a mid-turn failure of a waggle run, where the
review may be offered a second time. Giving that path its own outcome mapping means restructuring waggle run
orchestration, which belongs in its own change rather than at the end of this one.

## Round thirteen, and a decision about the case-folding guard

Round thirteen found that two of round twelve's repairs had themselves broken ordinary operations, and both of
its blockers were in code added to guard a pre-existing edge case. That is the point at which the guard stopped
being worth having, so it is gone.

| Finding | Substance | Outcome |
| --- | --- | --- |
| E1-1, E3-1 | Every `--amend` was refused when HEAD is a merge commit | guard removed |
| E1-2 | An amend that removes part of the previous commit was refused | guard removed |
| E1-3 | A change living only in the index is dropped and reported as success | pre-existing; recorded |
| E2-2, E3-2 | A run cancelled before its prompt was marked as having reached the agent | fixed |
| E2-1 | A cancelled first send reports the user's own Stop | fixed earlier; re-verified |

**Why the guard is gone rather than fixed again.** Its premise - "a path the commit did not record was omitted"
- is simply false in two ordinary cases. An amend legitimately drops a path when the user reverts part of the
previous commit, and `git diff-tree` prints nothing at all for a merge commit, so amending on a merge looked
like a total omission. Both were reported as case-folding failures, which is not even the right explanation.
Counting attempts: the dangerous shapes were predicted from path strings three times, each wrong in a different
direction, and verified after the fact once, which broke the first commit in a repository, amends on merges,
and the everyday revert-in-amend. Four attempts, five regressions in operations users perform daily - against a
pre-existing limitation that predates this branch and merely leaves the change visible in `git status`.

Removing it restores the commit path to what rounds one to ten exercised, and the limitation is documented
instead:

> On a filesystem that folds letter case, a rename that differs only by case in any path component cannot be
> committed through a pathspec. Git either refuses it outright ("will not add file alias", reported as
> `case-only-rename`) or resolves the new spelling onto the existing entry, in which case the rename stays
> staged and visible in `git status` while the rest of the selection commits. Committing it needs a temporary
> intermediate name, or the command line. Doing this properly means building the commit with
> `write-tree`/`commit-tree` rather than a pathspec, which is its own change.

The delivery marker was corrected rather than removed, because that one has a right answer: a run whose signal
was already aborted returns from the kernel without prompting, so "the kernel returned" was never "the agent has
the message". It is now taken from the kernel actually producing a turn.

Two round-thirteen items outside the guard are settled here too.

A cancellation reported by a *first* send arrives wrapped in the `FirstSendFailed` that names the session it
created, so the "is this worth telling the user" check did not recognise it and reported their own Stop as a
failed send. It unwraps first now.

**E1-3, recorded rather than changed.** A selected path whose change exists only in the index - staged, then
reverted in the working tree - is committed as the working-tree version, because that is what
`git commit -- <paths>` means: it commits the working tree state of the paths it is given, not the index's. The
staged version is therefore not in the commit, and the commit reports success. This is git's own semantics for a
partial commit rather than a defect in the panel, and changing it would mean building commits from the index with
`write-tree`/`commit-tree` - the same change the case-folding limitation would need. Recorded together with it.

## Round fourteen

The whole-branch reviewer returned **zero findings** and recommended merging. The two focused reviewers found
one each, and both were the same mistake in two places: logic duplicated on a path that already had an owner.

| Finding | Substance |
| --- | --- |
| F2-1 | A draft review was claimed by whichever existing session the user switched to next |
| F1-1 | The panel expanded rename sources itself, unconditionally |

**F2-1 is the fourth appearance of one class, so the inference is gone rather than narrowed again.** The
success-path review migration fired whenever the panel's key stopped being the draft key - which is the lazily
created session appearing, and equally the user clicking an existing session in the sidebar. In local mode every
session in a project shares one working path, so the draft key is unchanged across that switch and a review
written against the draft was merged into another session's thread, from where submitting posts it into that
conversation. Narrowing this condition failed in rounds seven, eight and eleven; there is no longer a condition.
A review that must move still moves - a failed first send carries the id of the session it created and the
review follows it there - and an unsubmitted draft simply stays under the working path, where it reappears
whenever the panel is on the draft. Nothing lost, nothing misfiled.

**F1-1 is the same lesson about the commit set.** `commitGit` expands a rename's source *conditionally*, skipping
one that something now occupies, because `git commit -- <paths>` commits the working-tree content of the paths it
is given. The panel expanded it too, unconditionally, and main only ever adds to the caller's selection - so an
occupied source supplied by the panel could never be taken back out. The panel now passes target paths only,
agreeing with the header dialog, and the single owner does the rest.

## Round fifteen

The whole-branch reviewer again returned zero findings and recommended merging. The focused reviewers found
three, each a case where a guard or an anchor was *nearly* right.

| Finding | Substance |
| --- | --- |
| G1-1 | The default-branch confirmation never fired in a repository whose remote was added locally |
| G2-1 | In worktree mode the draft anchor moved out from under the reviewer's scope and review |
| G2-2 | "Add comment" dropped the comment, and the failure, in silence |

**A guard that cannot answer must answer yes.** `refs/remotes/origin/HEAD` is what records the default branch
locally, and `git clone` writes it while `git init` plus `git remote add` does not - verified against real git.
In such a repository the default branch resolved to nothing, `isDefaultRef` read false, and a one-click
Commit & push reached the default branch with no confirmation at all. Unknown now counts as yes: asking once too
often is the harmless direction, and this is the second time on this branch that a default-branch gate had to be
taught to fail closed.

**An anchor has to be something that does not move.** Round eight recorded that a new session inherits the scope
its draft was written in - true in local mode, where the draft's working path is the opened checkout and stays
that way. In worktree mode the session's birth moves the working path to the new worktree, so an anchor built
from it moved too, and both the scope the reviewer chose and the review they wrote were left under the old path.
The anchor is the opened repository now, which does not move.

**And a fire-and-forget send loses whatever it was carrying.** "Add comment" - the single-comment action, not the
review - was dispatched without awaiting, so a refused send took the comment with it silently. It goes into the
pending review on failure, where the reviewer still has it. That is the fourth send path on this branch to need
the same correction, and the last one that had it missing.

## Round sixteen

The whole-branch reviewer returned two findings this time rather than zero, and both were the same as one of
the focused reviewers': my round-fifteen repair to the single-comment action had reimplemented a *subset* of
what the review path already owned. That is the shape the record has now named thirteen times, and this one was
mine, added while fixing the previous round.

| Finding | Substance |
| --- | --- |
| H2-1, H3-1 | "Add comment" handed back a comment the agent already had, and reported a failure that had not happened |
| H2-2, H3-2 | "Add comment" kept a comment under a key the panel had already left |
| H1-1 | A branch checkout left the default-branch gate reading the branch the user had left |
| H1-2 | A rebase or cherry-pick conflict was not guarded, and staging destroyed it |
| H2-3 | The inherited scope was a standing lookup, so a later draft moved an existing session's scope |

**Both "Add comment" findings had one cause and now have one implementation.** Deciding what to do with work
whose send failed has three parts - a failure after the agent had the message is not a lost send, a first send
changes where the panel looks, and the user hears about it only when something went wrong - and the review path
had all three while the comment path had one. They share a single function now.

**`MERGE_HEAD` is not the same question as "are there conflicts".** A rebase or cherry-pick leaves unmerged
index entries without writing it, verified against real git, and this is a *pathspec* commit - which git permits
with unmerged entries where it refuses a whole-index one. Staging first marked the conflict resolved with the
markers still in the file, so a rebase committed them and reported success, and a cherry-pick failed *after* the
three-stage entry was gone, leaving the markers looking like the user's own resolution. The guard asks
`git ls-files --unmerged` now.

**A checkout invalidated one cache and not the other.** The VCS status carries `isDefaultRef`, which the push
confirmation waits on, so checking out the default branch and pressing Commit & push inside the cache window
pushed to it unasked - the third time on this branch that this particular confirmation has had to be repaired.

**And inheritance had to be a hand-off, not a standing lookup.** A session with no scope of its own read the
draft's on every render, so whatever the *next* draft in that project chose became that session's scope
retroactively, taking the key of any pending review with it. The session takes a copy once.

## Round seventeen

Both of round sixteen's repairs turned out to be incomplete, and the whole-branch reviewer refused the merge
over one of them. Both are fixed, and one of them by deletion.

| Finding | Substance |
| --- | --- |
| J1-1, J3-1 | The conflict guard only saw the opened directory, so a conflict elsewhere committed its markers |
| J2-1, J2-2 | Scope inheritance still moved an existing session, and could hand it another project's scope |
| J1-2 | A non-default `push.default` can send the push somewhere other than the confirmed ref — recorded |

**`git ls-files --unmerged` is scoped to the directory it runs in.** The guard was asked before the repository
root was resolved, so with the project opened at a subdirectory a rebase or cherry-pick conflict anywhere else was
invisible: the guard passed, staging marked the conflict resolved with the markers still in the file, and the
commit recorded them and reported success. It is asked from the root now - which is where every other part of this
commit path was already careful to work, and the one place that was not.

**Scope inheritance was the fifth attempt to infer the draft-to-session relationship, and it is gone.** A standing
lookup made whatever the *next* draft chose become an existing session's scope retroactively; the one-time copy
that replaced it ran on mount, so a session could take another project's scope and base ref. A new session now
starts on the working-tree scope. The reviewer's pending work never depended on this: a draft review is anchored
to the opened repository, which does not move, and a review submitted on a first send follows the session id that
send reports. The count for this relationship is five inference attempts, five different failures, and no
inference now.

Recorded rather than fixed: **`push.default`**. The confirmation asks about the current ref, while the push itself
is a bare `git push`, whose destination git takes from configuration - so a non-default `push.default` could send
it elsewhere. Naming the destination explicitly changes what pushing means for anyone relying on that
configuration, which is a deliberate behaviour choice rather than a defect fix, and belongs in its own change.

A flake was also found and fixed while validating this round, in the very area the branch was opened for. The
two-second bound on `ls-remote` was tight enough that a *local* remote lost the race under full-suite load, and
the caller then degraded silently to the working-tree diff. The bound exists to stop an unreachable remote hanging
the load, which ten seconds still does; a bound that turns a working case into a silent fallback is the same class
of defect the branch set out to remove.

