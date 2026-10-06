# Release, Versioning & CI/CD

## Git Hooks

Husky is configured with a `pre-push` hook. Pushes to `main` run the heavyweight gates:

- `pnpm prepush:main` (`pnpm check`, `pnpm format`, `pnpm test:all` including headless Playwright e2e)

Feature-branch pushes run `pnpm verify`: conventional-commit policy against the `origin/main` merge base, typecheck, lint, and unit tests. This keeps deterministic failures out of CI entirely; `--no-verify` remains available to humans for exceptional cases.

## CI/CD

CI is not tiered behind a merge queue (ADR 0033 refines ADR 0029). Pull requests and pushes to `main` run the same gate: Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, plus the always-present Package Release Gate that aggregates them. There is no Electron E2E and no merge queue; a PR merges directly once the required checks pass. A non-gating nightly canary (`.github/workflows/nightly.yml`) builds and smokes the packaged app on macOS/Linux/Windows.

Dispatched CI runs accept a `ci_tier` input — `full` (default, release validation) or `fast`.

Manual `full` CI also calls the same-commit Session Performance workflow and requires its success in the Package Release Gate. Dispatch the registered `ci.yml` from the branch containing the candidate, with `head_sha` equal to that branch's exact 40-character commit SHA and `ci_tier=full`. This works before the standalone performance workflow is registered on `main`. The benchmark runs `pnpm benchmark:session-release`, including the embedding checks, 100,000-Session vector index, and 10,000,000-message database corpus. Fast and visual CI do not run it; merge groups retain the separate Session Performance workflow without a duplicate CI invocation. Standalone manual performance dispatches remain available once GitHub registers that workflow.

Dispatched Commit Policy checks the commits after the candidate's merge base with the fetched `origin/main`. This preserves upstream-sync attribution even when `main` advances after the branch sync. Missing history, unrelated histories, or multiple merge bases fail the job; manual runs never substitute an empty range start. Merge-queue runs use their immutable event `base_sha` and synthetic merge head. Pull-request titles remain validated by pull-request CI, which has the authoritative title metadata.

The release workflow is Conventional Commit derived: when release-eligible commits land on `main`, release-please opens a generated version PR. GitHub creates that PR's CI in approval-required state because the PR uses `GITHUB_TOKEN`; the release workflow reruns that PR-associated run for the exact head, waits for it, and leaves the green PR open as an explicit maintainer gate. Release PR creation uses bounded retries and checks for an exact same-repository PR after each failed mutation so a transient or ambiguous GitHub API error cannot strand a valid release branch. The workflow checks fetched Git ancestry to detect a stale release branch, including when GitHub reports its merge state as `UNKNOWN` or `BLOCKED`. It validates the version-only change against the branch's merge base before synchronizing, then against the pinned current `main`. If `main` advances during CI, the workflow updates the release branch and repeats exact-head CI. The workflow never merges its own version PR. A maintainer's merge enqueues the release PR through the merge queue like any other; the queued merge result is what lands. The release run then verifies the exact version-only commit and its same-repository release PR, pushes only its tag, builds platform artifacts, and publishes a GitHub Release with checksums. Preparation runs share a coalescing concurrency group, while every publication run is keyed by its immutable merge SHA so a later `main` push cannot replace a queued release. Reruns adopt compatible existing release branches, PRs, protected merge commits, and tags while rejecting conflicting state.

### Required-Check Settings Runbook

The workflow's job set and the repository ruleset must stay in sync. Apply these settings in the same admin window as the merge — between merge and swap, open PRs wait on a check that no longer reports (use the routine bypass if something must land in that window):

1. `Settings → Rules → Rulesets → OpenWaggle main protections → required_status_checks`: set the required contexts to `Commit Policy`, `Typecheck & Lint`, `Unit Tests`, `Integration & Component Tests`, `MCP Conformance`, `Package Release Gate`.
2. Remove the `merge_queue` rule from the same ruleset (ADR 0033): PRs merge directly once the required checks pass.

macOS release artifacts are signed and notarized when the signing secrets below are configured; Windows and Linux artifacts are unsigned.

Platform trust for v1:

- macOS Developer ID signing and notarization block `1.0.0`. They must be in the release workflow before the first RC, so the RC validation window exercises the same signing pipeline that Stable ships with. macOS in-app updates require a signed app.
- The signing identity is an individual Apple Developer Program membership. macOS installs an update only when it is signed by the same team as the running app, so changing the signing team later may require a one-time manual reinstall for macOS users.
- The first signed macOS build is expected to need a one-time manual reinstall from unsigned builds. Ship it during Beta, not RC.
- Required GitHub Actions secrets: `MACOS_CERTIFICATE_P12_BASE64` (the Developer ID Application
  certificate exported as `.p12`, base64-encoded), `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Without them Alpha and Beta macOS builds stay
  unsigned; the release workflow refuses to build RC and Stable macOS artifacts without them. The
  electron-builder config (`scripts/mac-signing.ts`) only chooses how to sign and never fails,
  because every electron-builder command, including `postinstall`, loads it. When configured,
  the release workflow verifies each app with `codesign`, `stapler`, and `spctl` before upload.
- The macOS build depends on the GitHub runner. notarytool needs its network while it waits for
  Apple's verdict, and `hdiutil` needs a working disk-image device to build the DMG.
  `patches/dmg-builder@26.17.0.patch` handles the `hdiutil` case first. When a `dmgbuild` call
  fails with `Device not configured`, `Resource busy`, or `Resource temporarily unavailable`, it
  retries that call alone, up to five attempts with 30 s to 4 min of backoff, and does not
  notarize again. Re-create the patch when `dmg-builder` changes version.
- When `scripts/macos-build-failure.ts` identifies a failed macOS build as notarytool losing its
  connection to Apple (a transport error or an Apple 5xx) or as one of those `hdiutil` errors
  failing `dmgbuild`, the whole build rebuilds and resubmits, up to three attempts in total. The
  job turns off Spotlight indexing once and stops XProtect before each attempt, because `hdiutil`
  fails under concurrent disk activity on hosted runners. A rejected submission, a credential
  error, or any other failure fails the first attempt. A notary rejection or credential error
  fails it even if the log also has a transient error from the other architecture. A third
  runner failure fails the job. Rerunning the failed jobs reuses the version job's result, but a
  rerun uses the workflow as it was at the release commit. A workflow fix only reaches the next
  release.
- Windows code signing does not block `1.0.0`; it is tracked as post-v1 work. Unsigned Windows installers show a SmartScreen warning on first install.
- Linux AppImage artifacts are not signed.

## Versioning

OpenWaggle uses semver with release channels. The `0.x` prerelease trains end without a Stable
release: the first Stable release is `1.0.0`, reached through the `1.0.0-<stage>.N` prerelease
train. From `1.0.0` onward, semver is a compatibility promise to users: a change that breaks a
covered surface requires a major version.

### v1 release train path

The `1.0.0` line starts at Beta; there is no `1.0.0-alpha.N` stage, because the `0.x` alpha
builds already served as the alpha stage.

1. `1.0.0-beta.1` is the first `1.0.0` build. It should also be the first signed macOS build, so
   the one-time manual reinstall coincides with the new version line. If Apple Developer approval
   is delayed, `1.0.0-beta.1` ships unsigned and a later signed `1.0.0-beta.N` carries the
   reinstall.
2. Remaining v1 work lands as further `1.0.0-beta.N` builds.
3. `1.0.0-rc.1` starts the release-candidate freeze once v1 work is complete and macOS signing is
   in the release workflow.
4. `1.0.0` Stable follows the RC validation window.

### RC freeze and promotion guard

During RC, `main` is frozen for app code: merge only release-blocker fixes, each of which cuts the
next `1.0.0-rc.N` and restarts the validation window. The Stable promotion dispatch fails closed
unless the content of `main` equals the content of the last RC tag, except for the root
`package.json` version and non-app paths (`website/**` except the bundled user docs under
`website/src/content/docs/**`, `docs/**`, `.agents/**`, and top-level `*.md`). Renames count on both
sides, so moving app code into an ignored path still blocks. A non-release change to app code
during RC, such as a `chore(deps):` lockfile bump, blocks promotion until it is reverted or
released as the next RC. A new major version (`X.0.0`) cannot be released without a
`X.0.0-rc.N` tag, including one computed from a breaking-change merge; later minors and patches may
release straight to Stable. The guard runs before any Stable release PR exists and again before
tagging. The guard blocks
promotion only; it does not block merges.

### After 1.0.0

OpenWaggle keeps one release line. Release-eligible merges to `main` prepare the next Stable
version (`1.0.1`, `1.1.0`, `2.0.0`), and the maintainer decides the cadence by when the release PR
is merged. There is no rolling Beta and no maintenance branch.

A Beta or Alpha line such as `1.2.0-beta.1` opens only by explicit `target_version` dispatch, for a
risky minor or a new major train. While it is open, Stable cannot receive a separate fix: a fix
ships as the next prerelease and reaches Stable through promotion. Open a prerelease line only when
it is expected to be promoted within about a week.

### v1 scope and release blockers

`1.0.0-rc.1` may start only when all of these are done:

- macOS signing and notarization run in the release workflow.
- RC builds reach Beta and Alpha update channels automatically.
- The in-app update restart asks for confirmation while an agent run is active.
- The release docs and release skill match the v1 release policy.
- No release blocker is open.

`1.0.0` Stable additionally requires a curated `CHANGELOG.md` entry and release notes for the
whole v1 train; these can be written during the RC window.

Everything else, including open feature, reliability-polish, dependency-pinning, and coverage
issues, is post-v1. A **release blocker** is any known bug that loses user data, prevents launch,
or blocks updating, at any stage. An open release blocker prevents entering RC; during RC it cuts a
new `1.0.0-rc.N` and restarts the validation window. A bug whose persisted data is intact and only
presents incorrectly is not a release blocker.

GitHub tracking: the `v1.0.0` milestone holds only the work that blocks RC, and the
`release-blocker` label marks release blockers. Issues outside the milestone are post-v1 by
default; there is no `post-v1` label.

### v1 compatibility promise

| Surface | Covered | Rule within one major version |
|---------|---------|-------------------------------|
| User data (sessions, settings, projects, credentials, Session Host database) | Yes | Every later release opens data written by any earlier release of the same major, migrating forward automatically. Downgrades are unsupported. |
| Sessions, Delegations, and Access CLIs, including machine output | Yes | Commands, flags, and JSON/JSONL output stay compatible. Additive fields are allowed; removing or renaming one is breaking. |
| Session Control through the OpenWaggle MCP server | Yes | Existing contract versions keep their semantics. Adding a new contract version beside the old one is not breaking. |
| Agent-definition schema | Yes | A definition valid under the first release of the major stays valid. |
| Supported platforms (macOS, Windows x64, Linux x64) | Yes | Dropping a platform or raising its minimum OS version is breaking. |
| Extension host contract | No | Governed by `@openwaggle/extension-sdk`'s own semver; `0.x` may break. |
| Pi-owned resources (Pi extensions, skills, prompts) | No | Follow Pi's compatibility; a Pi upgrade that breaks them is not an OpenWaggle major. |
| UI layout, copy, default settings, keybindings | No | May change in any release. |

To retire a covered field or command, ship the replacement beside it and remove the old one only in
the next major version.

| Stage | Example Version | What Happens On Release |
|-------|-----------------|-------------------------|
| Alpha | `1.0.0-alpha.N` | Increments `alpha.N+1` on release-eligible changes. |
| Beta | `1.0.0-beta.N` | Increments `beta.N+1` after the project moves to beta. |
| Stable | `1.0.0` | `fix:` increments patch, `feat:` increments minor, breaking changes increment major. |

Stage transitions use the same protected, version-only release PR as ordinary releases. Never
retag a prerelease or edit a GitHub release to simulate promotion.

Prepare an explicit forward transition from `main` with:

```bash
gh workflow run release.yml --ref main -f target_version=1.0.0
```

Manual release dispatches are accepted only from `main` and require an explicit target. The
workflow rejects equal versions, downgrades, and backwards channel movement, then creates the
normal version-only PR. A maintainer must merge that green PR before its tag and artifacts publish.
The same path can later open a new prerelease line such as `2.0.0-alpha.1`.

Update eligibility is monotonic: Stable receives Stable; Beta receives Beta, RC, and Stable; Alpha
receives Alpha, Beta, RC, and Stable. The app lists releases and selects the newest eligible
non-downgrade version itself, then points the updater at that release's metadata, so RC does not
depend on electron-updater's GitHub-provider channel rules (which treat RC as a custom channel). An
RC build with no saved preference defaults to Beta. Release packaging publishes the matching
metadata aliases for every eligible automatic channel because electron-builder does not generate
the cross-channel aliases for its GitHub provider. The app and
CLI persist one shared channel and explicitly disable downgrades. The app re-reads that
authoritative channel before installing a downloaded release and invalidates a release that is no
longer eligible. Automatic install on ordinary app quit is disabled on every platform so all
downloads pass through the explicit, authoritative restart action. The shell installer persists its
selected policy channel as a one-time Session Host intent instead of inferring future policy from
the downloaded artifact's version.

### Differential update downloads

Releases publish `.blockmap` files beside the macOS zip and DMG and the Windows installer (the
AppImage embeds its own), so electron-updater downloads only the blocks that changed. GitHub
release downloads reject multi-range requests with HTTP 501, so the app's feed sets
`useMultipleRangeRequest: false` and fetches single ranges, as electron-updater's GitHub provider
does. A simulated one-line release change downloaded 8.0 MB of a 354.7 MB macOS zip. The macOS and
Windows updaters diff against the previously downloaded update, so the first in-app update after a
manual install, or after a release without blockmaps, is a full download; later ones are
differential. `builder-debug.yml` is a local build dump and is not published.

### Update restart and relaunch

Updates download automatically in the background; installing is always a user action: **Restart
to update** in the app, `openwaggle update`, or the install script (`curl … | bash`). Quitting the
app never installs a downloaded update.

- An update restart never silently interrupts an agent run. The one exception is a run that starts
  while the update already shows as installing, the seconds macOS takes to unpack it before the app
  quits; the Session Host interrupts it at its stop deadline (ADR 0047). When the user chooses
  **Restart to update** and the Session Host has active runs in any session (window, Worker, or CLI-started),
  the app offers **Restart when idle** (default), **Restart now**, and **Cancel**.
- Active runs include standalone compactions; a Session counts once.
- **Restart when idle** installs once the Session Host has no active run. Runs started after the
  choice also count. The wait has no timeout and survives periodic or manual update checks,
  including a check that fails transiently; it ends only when no eligible update remains, for
  example after the Update channel changes. **Restart now** during such a check waits up to 30
  seconds for it; if the check is still running, nothing is interrupted and any Restart when idle
  wait continues. The update
  action stays visible with the number of runs it is waiting for, so the user can still choose
  **Restart now**.
- **Restart now** stops active runs and compactions through normal cancellation, recording them as
  interrupted, waits up to 30 seconds for them to settle, and then installs. A run that does not
  stop in that time, such as a queued Follow-up that starts meanwhile, is ended by the restart.
- With no active runs, the restart installs immediately without a dialog.
- Every install releases the Session Host before the app is replaced, the same way for all three
  actions (ADR 0047). The Host runs from the app bundle, and macOS Squirrel refuses to replace a
  bundle while any process from it is running ("App Still Running"); a Host left running would
  also keep serving the old version's code. The installer sends the Host an update stop, and the
  Host gives it a 10-second deadline. At the deadline it interrupts any Run still active, which
  ends as interrupted, and gives it 3 seconds to settle; running Actions, CLI waits, and exports
  end with the Host. The desktop app waits up to 20 seconds for the Host process to exit on
  macOS; on Windows and Linux it only requests the stop, because those installers replace the app
  themselves. `openwaggle update` and the install script always wait for it. An ordinary quit
  leaves the Host running.
- In a terminal, `openwaggle host stop --update` is that stop. With active agent runs it asks
  whether to wait for them (default), stop them now, or cancel, mirroring **Restart when idle**,
  **Restart now**, and **Cancel**. It asks on the terminal, so it works under `curl … | bash`;
  without one it waits for the runs. It leaves a Host alone while the desktop app is open.
- The app shows **Installing** as soon as the restart begins, because macOS unpacks and verifies
  the update before it quits; relaunching the old version meanwhile makes the install fail. If the
  installer reports an error, or the app has not quit after 3 minutes, the update shows as ready
  again with the reason. After the next launch, when the same update is ready again, the app says
  that it did not install, and says when another OpenWaggle process, such as
  `openwaggle mcp serve` or `openwaggle sessions wait`, was the reason.
- The app relaunches automatically after installing an update, and after a fresh install where an
  installer runs. This follows `pingdotgg/t3code`:
  - In-app updates install silently and force a relaunch on every platform
    (`quitAndInstall(isSilent: true, isForceRunAfter: true)`); Windows shows no installer wizard.
  - The Windows NSIS installer is one-click and launches the app when it finishes.
  - The macOS `.dmg` is drag-to-Applications and does not auto-launch. There is no `.pkg`.
  - A downloaded Linux AppImage is launched by opening it.
- `install.sh` launches the app when it finishes, because it is OpenWaggle's one-command desktop
  install (t3code's shell installer installs only its CLI, so it sets no precedent here). It skips
  the launch without a graphical session (SSH, CI, or Linux without `$DISPLAY` or
  `$WAYLAND_DISPLAY`), with `--no-launch`, or with `OPENWAGGLE_NO_LAUNCH=1`. On macOS it quits the
  running desktop window process (the app's only `Foreground` process; the detached Session Host
  and CLI processes share the bundle id but are `UIElement`) with `SIGTERM`, which Electron handles
  as a normal quit. Then it runs the installed version's `openwaggle host stop --update`, and only
  then replaces the bundle. If the user cancels there, it reopens the app and changes nothing. An
  installed version older than `--update` gets a plain `host stop --wait`, bounded to 20 seconds.
  On Linux the installer stops the Host the same way before it replaces the AppImage atomically.
  A running app keeps running, and keeps its Host; the installer tells the user to restart it.
- `openwaggle update` never opens a window the user did not have open and never installs under a
  running desktop app. If the app is running, a channel update only reports the available version
  and tells the user to install it from **Settings > General > About & Updates**, where **Check
  now** and **Restart to update** protect active runs and relaunch the app. An exact `--version`
  install refuses while the app is open. With the app closed, Windows and Linux stop the Session
  Host as `host stop --update` does, then install silently without launching it. macOS installs
  through the bundled install script, which stops the Host itself, because Squirrel.Mac always
  relaunches the app after an in-app install. The desktop-app check uses the single-instance lock,
  so it cannot see an app started with `OPENWAGGLE_DISABLE_SINGLE_INSTANCE=1` (automation only).

### Protected release recovery

The failed `0.3.0-alpha.44` direct-push attempt created a remote tag whose commit never reached protected `main`. Recovery intentionally sets the root version on `main` to `0.3.0-alpha.44` in a `chore(release):` reconciliation commit. That subject skips both release-PR generation and tag publication. The existing orphan tag is preserved for auditability; the next release-eligible change increments the reconciled root version and publishes `0.3.0-alpha.45` only after a maintainer merges the version PR that passed exact-head CI. Do not delete, move, or reuse the orphan tag.

## Release Notes

Conventional Commits are the app's release intent: they decide whether a merge produces a release
and, for Stable versions, whether it is a patch, minor, or major. OpenWaggle does not use separate
release-intent files. A change that breaks a covered surface must use a `!` Conventional Commit
title so it produces a major version.

- Prerelease builds use GitHub's generated release notes.
- Stable releases get a hand-written `## X.Y.Z` entry in the root `CHANGELOG.md`, and the same text
  is used as the GitHub Release notes (`scripts/app-release-notes.ts`). No release PR, branch, or
  tag is created for a Stable version without an entry: an ordinary merge records a notice and
  waits, while a `target_version` dispatch or a merged release commit fails. Write the entry on
  `main` first. `CHANGELOG.md` starts at `1.0.0`; it notes that earlier `0.x` builds
  used a legacy process and remain listed in GitHub Releases.
- The `1.0.0` entry summarizes the whole v1 train, not only the last RC.

Product-impacting PRs should still include reviewer-facing release notes in the PR body so the
Stable changelog can be written from them:

- User-visible feature or behavior changes.
- Relevant docs updates.
- Validation evidence.
- Known remaining scope or follow-up work.

Planned post-v1 guard: a CI check that fails when a PR changes a covered surface's contract without
a `!` title.

## Npm Package Publishing

OpenWaggle has a separate npm package publishing workflow for public package APIs. This workflow is distinct from the desktop app release train and does not use the root app version.

The first publishable package set is:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-react`
- `@openwaggle/waggle-core`
- `@openwaggle/pi-waggle`

### Package release safety contract

Package releases fail before merge. Every pull request reports an always-present `Package Release Gate` and `Package Release Candidate` and performs the complete release rehearsal on the exact pull request head: Node.js `22.19.0` and `24`, npm/pnpm/Yarn/Bun consumers, ESM/CommonJS/browser imports, tarball allowlists and metadata, generated package docs, public API compatibility, and installed-agent docs. An unprivileged classifier makes the artifact job's intentional skip explicit for ordinary pull requests. Only the trusted coordinated Release Please branch grants artifact permissions and executes repository checkout, build, smoke, attestation, and upload steps; the candidate aggregator fails unless the artifact result matches the classification.

The Release Please pull request is the final release candidate. Its green gate builds each final-version tarball once, records the Git tree identity and SHA-256 digest, and uploads the immutable artifacts with GitHub provenance. The repository pins the exact Release Please runtime embedded in the immutable action revision and preflight-tests its generated changelog shape and coordinated PR-title policy. For every upgrade, inspect that revision's `dist/index.js` for the exact runtime version. Dependency metadata alone is not evidence because upstream dependency bumps and bundle rebuilds can be separate commits. Update the root exact pin and lockfile, `scripts/release-please-contract.ts`, workflow SHA, validator fixtures and tests, and workflow AST hash together. Merging that pull request is an explicit maintainer decision; release pull requests are never auto-merged and repository rules have no routine release bypass.

After merge, publication must not rebuild, regenerate docs, or rerun quality checks. The publish workflow resolves the successful release-candidate artifact for the merged Git tree, verifies its provenance against `.github/workflows/ci.yml` and the selected source SHA and workflow run, verifies tree identity, digest, package/version plan, OIDC identity, dependency availability, and unpublished npm state, then publishes that exact tarball through npm Trusted Publishing. Every npm integrity and dependency observation uses bounded retries for transient registry/network failures only; deterministic content or response failures fail immediately and belong in the pre-merge gate.

Publish bases before dependents. A release plan that changes `@openwaggle/extension-sdk` must also release `@openwaggle/extension-react`, and a plan that changes `@openwaggle/waggle-core` must also release `@openwaggle/pi-waggle`; base-only plans fail before artifact preparation or promotion. After npm accepts and serves the exact version, create the immutable package tag and only then publish the matching GitHub Release. A GitHub Release must never claim availability before npm does.

The website guide under `website/src/content/docs/packages/<package>/<major>.<minor>/` is the canonical published package documentation. Published lines remain immutable; authors prepare a future line under `website/src/content/package-docs-next/<package>/`. `pnpm package-docs:update` generates committed package READMEs and current API-reference pages; `pnpm check` fails on drift. When Release Please crosses a major.minor boundary, its workflow promotes that pending source into the resolved version directory, removes the pending source, commits the result to the release branch, and validates that exact head. Package READMEs are self-contained npm landing pages with four tested package-manager commands and absolute documentation/support links. Installed agent docs expand website-only components into ordinary Markdown from the same source.

Package documentation uses exact `major.minor` lines, keeps historical lines immutable, and exposes an unversioned latest alias. A canonical docs change that changes a generated README, API reference, package metadata, install guidance, or supported public contract requires at least a patch release for the affected package. Website-only editorial changes that do not alter generated package surfaces do not release an npm package. Internal API snapshot tooling remains a compatibility gate and is not user-facing documentation.

GitHub uses the pull request title for the squash commit consumed by Release Please. Any pull request that changes `packages/**` therefore needs a release-producing `fix`, `feat`, or `revert` title. CI rejects package-changing `docs`, `chore`, or `refactor` titles that would silently skip the required version bump; generated Release Please titles remain exempt.

These packages use the MIT license, independent semver versions, Node.js `>=22.19.0`, and a shared Release Please package workflow. Initial public versions start at `0.1.0` and publish to npm's default `latest` dist-tag. `@openwaggle/pi-waggle` depends on `@openwaggle/waggle-core` and receives a dependent package patch bump whenever Waggle core changes. `@openwaggle/extension-react` depends on `@openwaggle/extension-sdk` and receives a dependent package patch bump whenever the extension SDK changes. A dependent package's own release intent may raise that bump.

`@openwaggle/extension-react` must not bundle React. It declares `react` and `react-dom` as peer dependencies with initial ranges of `^19.0.0`, while `@openwaggle/extension-sdk` is a normal dependency that publishes as a caret semver range. The package should also list React, React DOM, and their type packages as package-local dev dependencies for build and test coverage; those dev dependencies must not appear in the published runtime dependency graph.

`@openwaggle/pi-waggle` follows Pi's package contract for host-provided SDKs: imported Pi SDK packages are peer dependencies with a `"*"` range and are not bundled. Exact package-local dev dependencies pin the Pi version used for build and test coverage; the current tested line is `0.81.x`. This keeps a Pi-installed package on the host's single SDK instance while making compatibility changes visible through package QA.

`@openwaggle/waggle-core` must remain runtime-neutral reusable policy. It must not import Pi SDK packages, Electron, Node built-ins, OpenWaggle renderer stores, or app services. Pi-specific bindings, renderers, commands, and extension registration belong in `@openwaggle/pi-waggle`.

Package import boundaries must be enforced by repository standards checks that run under `pnpm check`. The checks should fail if `packages/extension-sdk/**` imports Electron, Node built-ins, Pi SDK packages, renderer stores, or main-process services; if `packages/waggle-core/**` imports Pi SDK packages, Electron, Node built-ins, renderer stores, or app services; if `packages/extension-react/**` imports OpenWaggle renderer components or app CSS/Tailwind internals; or if `packages/pi-waggle/**` imports Electron, renderer stores, or app services.

All public package source lives under `packages/*`. The first package directories are `packages/extension-sdk`, `packages/extension-react`, `packages/waggle-core`, and `packages/pi-waggle`. Each package owns its `src/` API source, emits built JavaScript and TypeScript declarations to package-local output, and publishes from its package directory. Do not create parallel package copies outside `packages/*`, and do not publish raw TypeScript source as the runtime contract.

Package builds should follow the `ts-match` plain TypeScript model by default: TypeScript project builds emit ESM output, CommonJS output, and declarations without bundling. Use package-local output directories such as `dist/` for ESM and declarations plus `dist-cjs/` for CommonJS, with a `dist-cjs/package.json` that marks the CommonJS subtree as `type: commonjs`. Do not introduce tsup, Rollup, Vite library mode, or dependency bundling unless a package has a documented reason to diverge.

Public imports are limited to each package's explicit `package.json` exports. Documented top-level and subpath exports are supported; deep imports into `src/`, `dist/`, `dist-cjs/`, or other internal files are not part of the public contract. Export smoke tests should validate every documented export and reject accidental reliance on private deep paths.

`@openwaggle/extension-sdk` should export public Effect Schema boundary values directly for manifests, contributions, broker payloads, docs discovery, and agent-loop DTOs. It should also provide helper APIs for common workflows such as defining and validating extension manifests so beginner authoring does not require direct Effect Schema usage. Effect Schema is the primary runtime schema contract for `0.1.0`; JSON Schema may be generated later as an additional artifact, but it should not replace the canonical Effect Schema boundary in the first release.

`@openwaggle/extension-sdk` must remain browser-safe. It must not import Electron, Node built-ins, OpenWaggle main-process services, renderer stores, or Pi SDK packages. Runtime helpers should operate on the brokered SDK/context values passed to extension mount code rather than reaching into host internals.

Package manifests should declare side-effect metadata explicitly. `@openwaggle/extension-sdk`, `@openwaggle/waggle-core`, and `@openwaggle/pi-waggle` use `"sideEffects": false`. `@openwaggle/extension-react` uses `"sideEffects": ["./styles.css"]` so bundlers can tree-shake component code without dropping the stylesheet export.

Every OpenWaggle publishable package must declare `publishConfig.access: "public"` so scoped package access is explicit and tarball validation can reject private-by-default ambiguity.

Package tarballs should include only the publishable contract:

- `dist/**`
- `dist-cjs/**`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`
- `styles.css` for `@openwaggle/extension-react` when emitted or copied as an exported package asset

Package tarballs should exclude repository and development artifacts:

- `src/**`
- `__tests__/**`
- development fixtures
- `tsconfig*.json`
- local scripts
- `.openwaggle/**`
- build caches
- generated source maps unless a later package decision explicitly enables them

Package validation should include API surface snapshots for every publishable package. Snapshot checks should compare the committed public TypeScript declaration surface against the newly built package output so unintended public API changes fail before publish. Prefer API Extractor-style declaration reports if they work cleanly with the four package outputs; otherwise use a deterministic repository-owned declaration snapshot script. In either case, `pnpm check` should fail on snapshot drift unless the snapshot update is intentionally committed in the same PR. Export smoke tests and package manager smoke tests still run; the API snapshot is the compatibility guard for the declaration shape.

The first explicit export maps should be minimal:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-sdk/manifest`
- `@openwaggle/extension-sdk/broker`
- `@openwaggle/extension-sdk/runtime`
- `@openwaggle/extension-sdk/theme`
- `@openwaggle/extension-sdk/ui`
- `@openwaggle/extension-sdk/agent-loop`
- `@openwaggle/extension-sdk/docs`
- `@openwaggle/extension-react`
- `@openwaggle/extension-react/styles.css`
- `@openwaggle/waggle-core`
- `@openwaggle/waggle-core/config`
- `@openwaggle/waggle-core/consensus`
- `@openwaggle/waggle-core/events`
- `@openwaggle/waggle-core/presets`
- `@openwaggle/waggle-core/prompts`
- `@openwaggle/waggle-core/state`
- `@openwaggle/waggle-core/turn-policy`
- `@openwaggle/pi-waggle`
- `@openwaggle/pi-waggle/commands`
- `@openwaggle/pi-waggle/extension`
- `@openwaggle/pi-waggle/loop`
- `@openwaggle/pi-waggle/mode-state`
- `@openwaggle/pi-waggle/preset-storage`
- `@openwaggle/pi-waggle/presets`
- `@openwaggle/pi-waggle/protocol`
- `@openwaggle/pi-waggle/renderers`
- `@openwaggle/pi-waggle/stop-policy`

Adding, removing, or changing a public export path is a package-contract change and must be reflected in semver and package release notes.

The first public publish uses the maintainer-owned `@openwaggle` npm organization scope. Do not publish these packages under a temporary personal scope.

Package publishing should follow the `ts-match` release model:

- Release Please manifest mode maintains one coordinated package version PR while packages retain independent versions.
- Merging that Release Please PR is the explicit release gate. Tagging, GitHub Releases, validation, and npm publication are automatic after the merge.
- Each package owns its package-local changelog.
- Package-specific tags identify published versions. Use short package-name tags: `extension-sdk-v0.1.0`, `extension-react-v0.1.0`, `waggle-core-v0.1.0`, and `pi-waggle-v0.1.0`. Do not include the npm scope in Git tag names.
- Each released package gets its own GitHub Release, matching its package tag and changelog, even when multiple packages are released from the same Release Please PR.
- `fix` produces a patch, `feat` produces a minor, and a breaking change produces a minor while the package is below `1.0.0`; after `1.0.0`, a breaking change produces a major.
- Direct package release intent is package-impact scoped. Release Please considers release-eligible Conventional Commits that touch `packages/<name>/**` or change that package's generated README/API/metadata source. App, unrelated website pages, general documentation, fixtures, and workflow-only changes do not release npm packages.
- Conventional Commit validation starts at the package-release bootstrap baseline and applies to every authored commit landing on `main`. Pull request titles must also be valid Conventional Commit subjects because GitHub uses them as squash commit subjects.
- Generated merge subjects are accepted when the merge does not change a publishable package, or when every incoming parent is already contained in the base branch. The second case is the update-branch merge a long-lived pull request makes to sync with `main`: any `packages/*` changes it carries are already released on the base with their own release commits, so the pull request owes no bump for them. A merge that brings `packages/*` changes **not** yet on the base must still carry explicit Conventional Commit release intent. Generated `Revert "..."` subjects are not exempt; use an explicit subject such as `revert(extension-sdk): restore the previous manifest contract`.
- Repository settings disable merge commits while preserving squash and rebase. Squash a one-intent PR with a Conventional Commit title. Rebase a mixed-intent PR when its app and package changes need separate Conventional Commits or different package release impacts.
- The Release Please `node-workspace` plugin patch-bumps and updates a dependent package when its OpenWaggle dependency releases.
- Packages ship built dual output from plain TypeScript builds: ESM, CommonJS, and TypeScript declarations. Package source and consumer-smoke fixtures remain TypeScript; CommonJS compatibility is exercised from TypeScript with Node's `createRequire`, and `.js`/`.cjs` files exist only as ignored compiler output or published artifacts.
- Pre-merge validation builds packages, checks every documented export boundary, checks public API snapshots, enforces a strict tarball allowlist, smoke-installs packed tarballs through npm, pnpm, Yarn, and Bun on Node 22.19+ and Node 24, and attests the exact validated release-candidate tarballs. Post-merge publication only verifies and promotes those artifacts.
- Publishing uses direct `npm publish <tarball>` through npm Trusted Publishing from GitHub Actions with `id-token: write`. Trusted Publishing supplies provenance automatically.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `npm stage publish`, or a local maintainer fallback for real package versions.
- Publish `extension-sdk` and `waggle-core` before `extension-react` and `pi-waggle`, respectively, and verify each base version is resolvable before publishing its dependent.
- The release job runs on Node 24 with pinned npm `11.18.0` until that pin is deliberately updated. Do not install `npm@latest` during a release.
- The protected GitHub `npm` environment has no npm secrets or required reviewers, accepts deployments only from `main`, and prevents concurrent package release runs.
- The additive `main` ruleset requires pull requests and green CI (Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, Package Release Gate) before a PR merges directly (ADR 0033, no merge queue). It allows only squash and rebase, and blocks force pushes and deletion without a routine bypass. Release Please package PRs remain open until a maintainer or explicitly authorized agent chooses to merge them. Repository settings disable merge commits so GitHub cannot synthesize a package-changing merge subject that passes PR checks but fails the commit policy on `main`.
- Recovery dispatches the Package Release workflow from `main` with the exact merged release commit SHA. The workflow verifies that commit is reachable from `origin/main`, finds the newest first-parent commit that changed a package manifest and uses its parent as the pre-release baseline, matches the merged release Git tree to the successful attested release-candidate artifact, and resumes only missing package versions whose registry integrity still matches. Recovery never rebuilds or replaces an existing version.
- A bad published version is deprecated and followed by a corrected patch. Do not overwrite or routinely unpublish immutable package history.
- Normal package releases are stable semver versions published to `latest`. The workflow does not support `next`, `beta`, or `rc` channels until a separate prerelease policy is accepted; the setup-only `bootstrap` tag is the sole exception.
- Package-only publishing does not require full desktop app release validation unless the same change touches app behavior.
- Packages stay in the OpenWaggle monorepo for the first public releases. `@openwaggle/waggle-core` should remain extraction-friendly and may move to its own repository later only if real adoption or contributor pressure justifies the cross-repository release overhead.
- Each package ships a committed generated package-local README for npm/GitHub consumers, while openwaggle.ai remains the canonical authored source for install instructions, import paths, examples, API surface, and links between related packages. User-facing package docs and package READMEs do not explain API snapshot tooling or internal release workflow; those remain internal validation and release artifacts.
- The OpenWaggle app consumes monorepo packages through `workspace:*`. Published package manifests must resolve workspace dependencies to caret semver ranges for the released dependency version, such as `^0.1.0`, during packing/publishing. Tarball smoke tests must prove those manifests work outside the workspace.

### One-Time Namespace Bootstrap

npm Trusted Publishing can only be configured after a package record exists. The repository therefore provides one resumable bootstrap command with two modes:

```bash
pnpm package-release:bootstrap
pnpm package-release:bootstrap --execute
```

The default mode is read-only and reports every intended registry and GitHub change. `--execute` requires a clean, up-to-date `main`, authenticated npm and GitHub sessions, npm 2FA, and pinned npm `11.18.0` or a deliberately approved newer version.

npm does not provide a reliable read API for the per-package `mfa=publish` policy. Read-only preflight therefore reports that policy as unverified and pending rather than claiming the package is fully compatible. Execution safely reasserts `mfa=publish` for every package on each run.

The execution mode:

1. Runs full package validation before changing external state.
2. Publishes minimal `0.0.0-bootstrap.0` package records under the non-default `bootstrap` dist-tag. npm also assigns `latest` when the first package record is created and does not allow that sole-version tag to be removed.
3. Sets package publishing access to `mfa=publish`, which requires interactive 2FA and disallows automation-token publication while retaining OIDC publishing.
4. Deprecates the bootstrap placeholder before configuring trust. The first trusted `0.1.0` publish replaces `latest` with the real release.
5. Configures and verifies each package with `npm trust github`, pinned to `OpenWaggle/OpenWaggle`, `package-release.yml`, environment `npm`, and direct publish permission only.
6. Creates or verifies the GitHub `npm` environment and additive `main` ruleset with only the administrator emergency bypass, then enforces merge commits off with squash and rebase on. The repository update sends only those three merge-mode fields and verifies the resulting state, so unrelated repository settings are not overwritten.

The one-time bootstrap kept source manifests at an unpublished baseline until the canonical `0.1.0` Release Please PR. All four source manifests are now `0.1.0`, and subsequent real versions are maintained by coordinated Release Please PRs and published by CI with provenance.

Responsibility split:

- OpenWaggle code owns package metadata, package build scripts, pack/smoke validation, Release Please configuration, GitHub Actions workflows, bootstrap automation, repository policy validation, and package author documentation.
- Maintainers own the `@openwaggle` organization, npm and GitHub authentication, npm 2FA, execution of the one-time bootstrap command, review/merge of Release Please PRs, and final license confirmation.

Do not publish development extension fixtures, installed QA copies, the website package, or root desktop app artifacts through the npm package workflow.

Packaged app QA for extension authoring must still prove that installed builds discover user-authored packages from both supported roots:

- project-local `<project>/.openwaggle/extensions/<extension-id>/`
- global app-data `extensions/<extension-id>/`

Development fixtures may be copied into those roots for QA, but they must not be shipped as production content or preinstalled extensions.
