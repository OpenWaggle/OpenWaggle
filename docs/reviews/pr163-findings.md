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
