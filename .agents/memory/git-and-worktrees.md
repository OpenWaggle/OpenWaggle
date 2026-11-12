# Git and worktrees

Git in OpenWaggle: worktree birth and branch tracking, worktree removal and Settings >
Worktrees, stashes, serialized Git mutations, WorkingPath versus RepositoryPath, source-control
providers and change-request creation.
Load when touching `src/main/adapters/git/`, `services/source-control/`, `features/git` or
worktree lifecycle code.

## Settings > Worktrees and Automatic worktree removal (ADR 0060, October 2026)

- Archiving never removes a worktree (`session-worktree-prune.ts`, `reason === 'archive'`): restore stays instant and `git worktree remove` would delete ignored files (`.env`, `node_modules`). Removal is only by hand from Settings or by the opt-in rule. Removing an archived Session's worktree keeps its binding and leaves the Workspace `ready` with no folder; a restored Session then meets the composer's missing-worktree choice (Recreate from the kept branch through `host-ui-worktree-operation.ts`, or continue in the current checkout). Host-loss recovery finalizes every `releasing` managed worktree, bound or not, since only a removal sets that state. `admitManagedWorktreeRemoval({ admitArchivedBindings })` counts only bindings of Sessions that are not archived, have a Run, or are missing; finalize deletes the resource only when nothing is bound. Prune treats Git's `not-found` with the folder gone as nothing to keep, so deleting such a Session is not blocked.
- `worktrees:inventory` lists repositories keyed by their canonical main checkout (a project opened as a subfolder or through its own worktree lists the same repository again; the first listing wins and only `opened` merges). Each entry's `projectPath` is the known project path that listed the repository, preferring one in the main checkout over one inside a linked worktree, never the bare main checkout: the removal preview goes through project authorization, which refuses a main checkout OpenWaggle does not know. Managed worktrees show for every project; hand-made ones only for the opened project. Groups: open idle Sessions make a worktree **In use** (with Archive & remove), not **Needs a decision**, or the 40 active worktrees of a normal setup flood it.
- The rule's decision is a pure shared helper (`src/shared/utils/automatic-worktree-removal.ts`) so the Settings preview can evaluate a rule that is not saved yet. The Host pass (`automatic-worktree-removal.ts`) runs a minute after start, re-checks every 10 minutes, acts at most once a day (last run in the JSON log under `userData/worktree-removal/`), and removes through the same `removeHostUiWorktree` path Settings uses, so every blocker is checked again.
- Reclaimable space is an `lstat` walk in the Host (one walk at a time, hard-linked files and other devices skipped, cached an hour). The renderer asks one worktree at a time (`measureInTurn`) so a page of 100 worktrees does not start 100 walks; `worktrees:measure` is refused while the Host drains.
- Archive & remove calls `dispatchNonHostUiLocalSessionCommand` directly; going through the Host UI dispatcher from inside a Host UI operation makes the module graph circular and TypeScript loses every inferred return type (`TS7023` across the dispatchers).

## Working-tree vs repository paths are branded (WorkingPath / RepositoryPath)

`src/shared/types/brand.ts` defines `WorkingPath` and `RepositoryPath`. Working-tree reads
and mutations (`getGitStatus`, `commitGit`, `getGitDiff`, `stageAllGitChanges`,
`revertAllGitChanges`, vcs-status, stacked actions, branch checkout/create) take a
`WorkingPath`; repository-level lists (branches, worktrees) take a `RepositoryPath`. Both
are erased strings at runtime, so IPC serialization is unaffected.

`resolveSessionWorkingDir` is the ONLY producer of a `WorkingPath` (in local mode it
rebrands the checkout — same string, correct role); `useRepositoryPath` produces the
`RepositoryPath`. So a working-tree mutation can only be fed from the session→tree rule,
and passing a repository/project path to one is a compile error. `git-path-brands.unit.test.ts`
pins this with `@ts-expect-error` on every wrong pairing — if a brand stops being enforced
the directive goes unused and the typecheck fails.

Branch checkout/create take BOTH a WorkingPath (git runs in a tree) and a RepositoryPath
(whose branch list to refresh) — equal only in local mode, which is the only place checkout
is reachable. The store's `checkoutBranch`/`createBranch` were previously handed one path
named `workingPath` and used it for both; the branding surfaced that conflation.

## Git stashes are shared by every worktree

`git stash` refs live in the common repository, not in a worktree. In a worktree with no local changes, `git stash -q` saves nothing and a following `git stash pop` applies another session's newest stash, conflicting dozens of unrelated files. Never use stash to compare against `HEAD`; run the check in a separate worktree or commit first.
It also bites with local changes: during the R5 review fixes (October 2026) a `git stash push <file>` / `git stash pop` pair raced with another Worker's own push/pop, and the two sessions swapped entries, each getting the other's uncommitted file. To prove a regression test fails without a fix, copy the file aside and write `git show HEAD:<file>` over it, then copy it back.

## Session branches do not track their base, and the push target never fails the status (issue #353)

`git worktree add -b <branch> <path> origin/main` tracks `origin/main` through `branch.autoSetupMerge`, so a managed Session branch then failed `push.default=simple` (names differ) and targeted `main` under `push.default=upstream`. `createGitWorktree` passes `--no-track`; the first push sets `<remote>/<branch>` as the upstream. Branches from older builds still track their base: `resolveTrackedPushRef` (`ipc/git/upstream-ref.ts`) resolves simple with a differently named upstream on the push remote to the same-named branch (Git's own "push to the branch of the same name" suggestion) with `replacesUpstream: true`, which `pushCurrentBranch` turns into `push -u` and the default-branch gate pins (`GitPinnedPushTarget.replacesUpstream`, part of the target identity). upstream/tracking with no upstream is a first push, not an error. `current` keeps the configured upstream; `upstream` with a tracked `main` keeps targeting `main`, which the gate confirms. `resolveLocalPushStatus` must never fail the Local VCS status for the push target alone (that put the Summary Git row, Commit included, behind "Retry Git status"): it reports `pushTargetRef: null, pushTargetIsDefaultRef: true`, and the main-process gate resolves the destination again before any push. Tests that depend on push config isolate the global config (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`): `managed-worktree-push.integration.test.ts`.

## Settings > Worktrees removal is confirmed and gated on use (issue #353)

The list can hold hundreds of worktrees, including the opened project's checkout and, in development, the one the app runs from. `application/worktree-usage.ts` derives each worktree's Sessions and removal blockers from `SessionWorkspaceResourceRepository.listWorkspaceOccupants` (every unarchived or running Session plus every managed-worktree owner, with its Workspace), `ActionRunService.list` (active runs), the terminal activity snapshot (owner keys are Session ids or `draft:<projectPath>`; a truncated or failed snapshot blocks, fail closed), the scope's project path, and `GitWorktreeService.applicationCheckout` (null when packaged). Paths compare by `realpath`. The renderer reads it through the `project-actions:manage` operations `worktree-usage` and `worktree-removal-preview` (added within Local Session revision 26, so no Host UI revision bump); the preview also counts `rev-list HEAD --not --remotes`. `removeHostUiWorktree` re-checks before admission and returns `worktree-in-use`; `force` overrides only Git's dirty and locked refusals. Every removal in the section, including cleanup recovery's Retry, Delete anyway and Force remove, goes through `WorktreeRemovalDialog`, whose confirm stays disabled until a fresh preview shows no blocker.

## Only `prepareBirth` marks a worktree birth pending (issue #353)

A local Workspace and a not-yet-created managed worktree both reach the preparation engine with `workspacePath === projectPath`, so `freshPreparationState` cannot tell them apart: it now records neither a folder nor a pending birth there, and `prepareBirth` (run right before `git worktree add`, from the first send's `onBeforeWorktreeCreate` and from `createHostUiWorktree` when the checkout is missing or the Workspace is pending) sets `awaitingWorktreeBirth`. Older builds wrote the flag on every local preparation; `recoverPreparationAfterHostLoss` clears it at Host start for records whose Workspace is `kind = 'local'` (`listLocalWorkspaceIds`), bumping the revision. It is not a ledger migration, so no migration id fences older binaries.

## Filed under "Renderer And Session Memory"

- Worktree birth fetches the chosen base branch from `origin` first (`src/main/adapters/git/remote-sync.ts`, `session-branch-freshness.ts`) and births from `origin/<base>` when the local branch is an ancestor of or equal to the remote tip; a local branch ahead of or diverged from the remote keeps its own tip, and fetch failures degrade to the recorded refs. Local-mode sessions run one best-effort `pull --ff-only` in `runPiAgentKernel` before their first run (`session.messages` empty), never on later turns. Birth tests mock `./session-branch-freshness`; its policy has its own unit tests.
- Routine Git status revalidation (turn boundaries, focus, broadcasts) must keep the status already on screen, and its loaded state, until the new answer lands; only a changed working tree clears it. Flipping to "Checking Git status" / "Checking PR status" on every refresh made the Session Summary flash each turn.
- A provider CLI can create a PR/MR remotely and still exit non-zero if its response is interrupted. Before surfacing create failure, resolve the exact head ref and adopt an existing request; after a successful create, retain the CLI's returned URL if the metadata lookup is transiently unavailable. This prevents duplicate requests on retry.
- Change-request creation follows the destination that actually received the push, including `pushurl`, remote branch, and repository owner. Require one compatible provider/authority/repository destination; GitHub fork creation uses `owner:branch`, recovery verifies owner/head/base, and browser fallback is withheld because it cannot verify the fork relationship. A bare local ref can target or adopt an unrelated same-named branch in the base repository.
- Hosted change-request identity accepts only network Git transports that preserve a meaningful provider authority (`http`, `https`, `ssh`, `git`, or SCP-like syntax). Never rewrite `file:` or an unknown remote-helper URL into a GitHub/GitLab web identity. A pinned push that uses command-scope `remote.<name>.pushurl` overrides must fail closed when the configured remote name contains `=`, because `git -c` would parse a different config key and silently stop pinning the approved destination.
- Main-process Git mutations are serialized by canonical checkout root, not the caller's opened subfolder. Worktree create/remove owns that same low-level boundary so IPC, first-send birth, and Session prune cannot race each other; linked worktrees remain distinct checkout identities.
- A successful commit or change request can still fail Session Output projection. The result contract exposes whether durable retry authorization was persisted; renderer actions must surface every projection failure and offer manual retry only for an authorized queued request, while retaining the remote request's browser URL.
- Source-control provider resolution is `services/source-control/` (ADR 0048): never decide a provider from the hostname alone. A recognised host is kept as written so `Host github.com` → `ssh.github.com:443` SSH configs do not move it; `gh` and `glab` host lists are read from their config files (`hosts.yml`, glab `config.yml`) because `gh auth status`/`glab auth status` hit the network. Tests that assert exact git command lists must allow the resolver's read-only lookups (`isSourceControlResolverRead` in the stacked-gates harness).
- Source-control Settings are written only with `SourceControlSettingsAccess.patch` (per-entry set/null-remove, applied serially by the process that owns the database; the window sends `source-control:patch-settings` to the Host). A whole-record `settings:update` from the window raced with Host writes and dropped entries. `git ls-remote` patterns are globs matched against the end of a ref, so `refs/pull/` matched nothing; use `refs/pull/*/head`. Remote hosts are validated (`isSourceControlHostName`) before they reach a CLI argument, a settings key, or the terminal sign-in command; a crafted remote like `https://github;id;x/o/r` was otherwise typed into a shell. Writes through the gh account runner (`runWrite`) never retry as another account. Per-project source-control keys go through `projectSettingsKey` (the main checkout), or the agent and the Session Summary use different keys for the same project. Unit and integration configs point `GH_CONFIG_DIR`/`GLAB_CONFIG_DIR` at a missing directory so tests never read the developer's sign-ins.

## Filed under "Session-owned Browser preview (ADR 0031, September 2026)"

Summary startup can fan out duplicate Git reads from multiple mounted consumers. A September 12 native probe recorded four status and three branch-list IPC calls for the same path, 74 Git children, and a successful local VCS result after 12 seconds without retries. Sharing pending reads reduced this to 30 children and 819–847 ms branch readiness in three native repetitions. Cap admission to a pending read at 30 seconds so a hung local Git child cannot poison future refreshes, and require pending identity before cache publication. Invalidation must include pending status paths in generation updates, and an old completion must not remove a newer pending read. Branch lists share refs across linked worktrees, so any Git mutation detaches their pending reads globally; completed lists remain uncached.

## Filed under "Product And UX Memory"

- Worktree birth is an app-owned launch lifecycle before Pi starts. Show the full creation card while any launch step runs, then persist a compact expandable `Worktree created` custom event in the transcript. Local launches show a live step card too but leave no creation trace; cancelled births leave none either.
- Everything a first send waits on before `agent_start` is a labelled launch step (`WorktreeLaunchProgress.label`): pull the base from origin, create the worktree, run Setup (only when a Setup definition will run), pull the local branch (only when it has an upstream). A measured local first send spent 4.7s in `git pull` and 10.4s connecting four MCP servers with nothing on screen. Steps are sequential by default; `parallel` steps (local pull and MCP) stay open until their own `completesStep`, because they now run concurrently. Report steps only on a Session's first run or when a later run really prepares its worktree: an existing recorded worktree reported "recovered" on every turn and flashed a launch card and a Connecting status.
- The composer owns environment and ref as separate controls before the first turn. First send freezes the launch plan and collapses that setup dock; worktree creation leaves its compact trace in the transcript. The plus menu routes to existing attachment, project-file, skill, and Waggle flows rather than duplicating their state.

## Filed under "Session Host authority and subscriptions are live boundaries"

For managed-worktree cleanup, a retained preparation snapshot belongs to a directory generation,
not merely a project and worktree path. Pin the worktree directory's inode and birth time (the
record also keeps `device`, for diagnosis only) when the checkout exists; a pre-birth snapshot
gets its identity after materialization. Never compare a persisted `st_dev` where a birth time is
recorded: macOS renumbers APFS volumes at mount, and on 2026-10-20/21 it went 16777230 ->
16777233 -> 16777230 over two reboots, so every pre-reboot worktree failed with "no longer
matches its saved preparation" until its record was hand-patched. Project Actions and Workspace
preparation compare persisted identities only through `isSameDurableDirectoryIdentity`
(`src/main/domain/workspace-generation.ts`), which uses `device` only when the filesystem records
no birth time. Profile credential receipts (since #330) compare through
`isSameDurableDirectoryIdentity` too; legacy `dev:ino` receipts are matched by inode only.
In-process checks may still compare it, such as the language-detection cache
(`workspace-language-detection.ts`) and the open-versus-resolve check in
`filesystem-inline-visualization-service.ts`. `inspectWorkspaceGeneration`
returns `current`, `replaced`, `unreadable`, `awaiting-birth` or `unrecorded`; the Host log under
`workspace-preparation` records that status with the raw identities, and the error names the path
and both identities. Recovery copy says to delete, not move, a mismatched worktree: a moved copy
still points at the git data Recreate worktree reuses. If the recorded generation is missing or
differs at removal, do not execute its pinned cleanup command in a replacement checkout. Explicit
Delete anyway can still skip that cleanup. A snapshot with no cleanup-phase definition has nothing
to protect: removal records cleanup skipped before the generation check, and Settings does not
flag the mismatch (issue #332, `preparationPinsCleanup`). A disabled cleanup definition still
counts as pinned. `describeCleanupBlockedByGeneration` is only for snapshots that pin a cleanup.
Retained-preparation listing must include generation mismatches of a snapshot that pins a cleanup
even when cleanup status is idle or succeeded. Settings must keep Delete anyway visible for those
rows and explain why Retry cannot run the pinned cleanup in the replacement directory.

A Host that stops between `git worktree add` and setup dispatch's `capture` leaves the
preparation `awaiting-birth` with the folder in place. Setup dispatch records any folder it finds;
a run that reaches the generation check with the birth still pending (a Project Action run, or an
agent run whose Session's dispatch has nothing pending, e.g. another Session in the Workspace)
calls `completeWorktreeBirth` (`preparation-birth-recovery.ts`). It records the folder only when
setup has not started, the folder's birth time is no more than 1 s before
`awaitingWorktreeBirthSince` (the slack covers coarse filesystem clocks), and Git reports it as a
finished linked worktree of the project (`GitWorktreeService.inspectLinkedWorktree`): same common
dir as `isWorktreeOf`, a git dir of its own, `--show-toplevel` equal to the folder (not a folder
inside a worktree), `<gitDir>/gitdir` (relative to the git dir under Git 2.48+
`worktree.useRelativePaths`) naming this folder's `.git` (not a `cp -R` copy of another live
worktree, which shares that worktree's HEAD and index), and no `locked` file, which
`git worktree add` keeps until its checkout finishes. Anything else keeps failing closed.
`awaitingWorktreeBirthSince` is `Date.now()` when a record starts pending (`freshPreparationState`,
for `capture` and `select` before the worktree exists) or is reset (`resetPreparationForBirth`),
and `prepareBirth` refreshes it on an already pending birth (`refreshPendingBirth`), so a retry,
or a pending record saved before the field existed, gets the time of the attempt that runs
`git worktree add`. The field exists only while the birth is pending. A run-recorded birth also
sets `runBirthSetupOwed`, since no setup dispatch ran for it: every agent run, in any Session,
gates on setup (`owesSetupAfterRunBirth`, then `requireSetup`) until setup has succeeded or been
skipped. `save` drops the marker then, and so does the final write of
`executeWorkspacePreparation`, which bypasses `save`. A failed setup keeps it, and `select` carries it over. Older builds decode stored
preparations exactly, and `recoverAfterHostLoss` lists all of them before the Session Host
listens. So after a downgrade, one record with either field (a pending birth, or setup still owed
after a run recorded the birth) stops the older Host from starting (downgrades are unsupported).
