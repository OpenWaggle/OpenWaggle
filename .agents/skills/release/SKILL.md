---
name: release
description: This skill should be used when designing, implementing, reviewing, or operating OpenWaggle releases, version bumps, changelog/GitHub release notes, updater channels, signing, installers, or Alpha/Beta/RC/Stable update-channel behavior.
---

# OpenWaggle Release & Versioning

Use this skill to keep OpenWaggle release behavior aligned with the v1 release policy. The policy is ADR 0040 (`docs/adr/0040-adopt-the-v1-release-policy.md`); the canonical rules are in `docs/release-and-versioning.md`. PRD #90 is closed and superseded; do not implement its release-intent files.

## Load first

Before changing release, versioning, updater, changelog, GitHub workflow, installer, signing, or Update channel behavior:

1. Read `docs/release-and-versioning.md` and ADR 0040. Read ADR 0032 for Build identity and Build channel.
2. Use the `CONTEXT.md` terms **Build channel** (the installed artifact's stage), **Update channel** (the user's saved update selection), **Compatibility promise**, **Covered surface**, and **Release blocker**.
3. Inspect the current `release.yml`, `scripts/app-release-state.ts`, `src/main/update-feed.ts`, `src/main/updater.ts`, `scripts/prepare-update-channel-metadata.ts`, `scripts/install.sh`, and the Settings About/Updates UI before editing.
4. Preserve `AGENTS.md` rules: no commits without approval, no unknown-work reverts, Electron QA for renderer/preload/IPC changes, and `grill-with-docs` for any new release decision.

## Release domains

OpenWaggle has two independent release domains:

- The **App release workflow** publishes desktop artifacts and update metadata. Its release intent is the Conventional Commit subject of merges to `main`.
- The **npm package workflow** publishes the packages under `packages/*` through Release Please with path-scoped Conventional Commits.

Do not let package releases drive the desktop app version, and do not let package GitHub Releases become the repository's "Latest" release.

## App release core policy

Keep automation, but keep publication approval explicit. Every generated desktop app release PR stays open until a maintainer or explicitly authorized human merges it; the workflow never merges its own release PR and never depends on a ruleset bypass.

## Runtime/SDK agnosticism

Keep release policy independent of any one runtime, CLI, or SDK. The v1 train is not tied to one runtime; `/release` must remain reusable if OpenWaggle later supports or switches to another runtime integration.

- Describe release readiness in product terms: launch, provider/auth/model selection, project selection, prompt execution, streaming/tool rendering, persistence, sessions, branching, install/update, and blocker status.
- Do not encode Pi-specific terms, files, adapters, or SDK behaviors into release policy unless the task is explicitly about the Pi implementation.
- Keep runtime-specific implementation details in runtime integration skills/docs, not in `/release`.
- If a future CLI/SDK becomes part of OpenWaggle, apply the same Alpha/Beta/RC/Stable, changelog, updater, and UI policies to that integration.

## Npm package policy

The canonical package policy lives in `docs/release-and-versioning.md` and ADR-0008.

- Publish `@openwaggle/extension-sdk`, `@openwaggle/extension-react`, `@openwaggle/waggle-core`, and `@openwaggle/pi-waggle` with independent semver versions through one Release Please manifest workflow.
- Use one coordinated Release Please PR, package-specific changelogs, component-qualified tags, and one GitHub Release per package version.
- Treat release-eligible Conventional Commits that touch `packages/<name>/**` or an affected package's canonical generated documentation source as direct package release intent. Unrelated app, website, documentation, fixture, and workflow-only changes do not release npm packages.
- Require Conventional Commit pull request titles for squash safety. Keep repository merge commits disabled while preserving squash for one-intent PRs and rebase for mixed-intent PRs whose commits carry separate release impacts. Do not exempt generated revert subjects from explicit release intent; write reverts as `revert(scope): ...`.
- Let the Release Please `node-workspace` plugin patch-bump `extension-react` when `extension-sdk` changes and `pi-waggle` when `waggle-core` changes.
- Keep the Release Please PR merge as the explicit human or authorized-agent release decision. Never auto-merge release PRs and never depend on a ruleset bypass.
- Require an always-present `Package Release Gate`. Relevant PRs perform the complete Node 22.19/24, npm/pnpm/Yarn/Bun, browser, tarball, docs, and API rehearsal. The Release Please PR builds and attests the final-version tarballs once.
- Pin the local Release Please runtime to the exact version embedded in the immutable action revision. Verify the version in that revision's `dist/index.js`, not from dependency metadata, and update the pin, lockfile, central contract, workflow SHA, tests, and workflow hash together.
- Authors prepare future major.minor package guides under `website/src/content/package-docs-next/<package>/` without modifying published lines. Before exact-head Release Please CI, run `pnpm package-docs:update` on the generated release branch, promote that pending source, and commit the new versioned line. Exact-head CI must validate that synchronized commit, not the pre-generation head.
- After merge, do not rebuild, test, or generate docs. Verify and publish the exact PR tarball by Git tree, SHA-256, provenance, OIDC identity, dependency state, and unpublished version through npm Trusted Publishing. Do not use `npm stage publish`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or another long-lived npm credential.
- Create the immutable package tag after npm accepts the exact version; create the GitHub Release only after that npm version is resolvable.
- Publish base packages before dependents: `extension-sdk` before `extension-react`, and `waggle-core` before `pi-waggle`.
- Require Node.js `>=22.19.0` for all four packages. Validate consumers on Node 22.19+ and Node 24; publish with Node 24 and a pinned npm CLI that supports trusted publishing.
- Bootstrap npm package records only through the documented one-time `0.0.0-bootstrap.0` flow. Real versions, beginning with `0.1.0`, publish only through GitHub OIDC with provenance.
- Recovery reruns resume one exact attested release-candidate artifact and publish only a missing matching version; they never rebuild it.
- The namespace bootstrap must verify repository merge modes, patch only the three owned merge-mode fields when they drift, and verify merge commits are disabled while squash and rebase remain enabled.
- Deprecate a bad published version and release a fix. Do not overwrite or routinely unpublish immutable package history.

## Version train

- The `0.x` trains end without a Stable release. The first Stable release is `1.0.0`.
- The `1.0.0` line starts at `1.0.0-beta.1`, ideally the first signed macOS build. There is no `1.0.0-alpha.N` stage.
- Train: `1.0.0-beta.N` -> `1.0.0-rc.N` -> `1.0.0`.
- Stage jumps use the Release workflow's `target_version` dispatch from `main`; it opens an ordinary version-only release PR.

Meanings:

- Beta: opt-in validation; remaining v1 work lands here.
- RC: release-candidate freeze; release-blocker fixes only.
- Stable: normal/default users.

## Compatibility promise

From `1.0.0`, breaking a Covered surface requires the next major version. Covered: user data (forward migration within a major, no downgrades), the Sessions/Delegations/Access CLIs and their machine output (additive fields allowed), Session Control over the OpenWaggle MCP server (keep existing contract versions' semantics), the Agent-definition schema, and supported platforms. Not covered: the extension host contract (follows `@openwaggle/extension-sdk` semver), Pi-owned resources, UI layout, copy, defaults, and keybindings. Retire a covered field by shipping its replacement beside it and removing it only in the next major.

## Release intent and notes

- Conventional Commits decide whether a merge releases and, for Stable, the bump: `fix:` patch, `feat:` minor, `!`/`BREAKING CHANGE` major. On prereleases any `feat:`/`fix:` increments `N`.
- There are no `.release/changes/*` files and no `release:none` classification.
- A change that breaks a Covered surface must use a `!` title. A CI guard for this is planned post-v1 (#259).
- Prereleases use GitHub's generated release notes.
- Stable releases get a hand-written root `## X.Y.Z` `CHANGELOG.md` entry reused as the GitHub Release notes; the workflow fails closed without it (`scripts/app-release-notes.ts`). `CHANGELOG.md` starts at `1.0.0` and notes the legacy `0.x` process; the `1.0.0` entry summarizes the whole v1 train.
- Product-impacting PRs include reviewer-facing release notes in the PR body.

## v1 scope and release blockers

`1.0.0-rc.1` requires: macOS signing and notarization in the release workflow (#253), RC delivered to Beta and Alpha (#254), the update restart rules below (#255), relaunch after install (#256), the RC promotion guard (#257), Stable-only GitHub "Latest" (#261), docs and this skill matching the policy, and no open release blocker. `1.0.0` also requires the curated changelog (#258). Everything else is post-v1. Track RC-blocking work in the `v1.0.0` milestone and defects with the `release-blocker` label.

A **Release blocker** loses user data, prevents launch, or blocks updating. It blocks entering RC; during RC it cuts `rc.N+1` and restarts the 7-day window. Intact data shown incorrectly is not a release blocker.

## RC freeze and promotion

- During RC, `main` is frozen for app code: merge only release-blocker fixes.
- Stable promotion fails closed unless `main` matches the last RC tag's tree except the root `package.json` version and `website/**` (but not the bundled `website/src/content/docs/**`), `docs/**`, `.agents/**`, and top-level `*.md`; renames count on both sides. A new major (`X.0.0`) requires an RC tag. The guard blocks promotion, not merges.
- Promote after a 7-day RC window with no open release blocker.

## After 1.0.0

One release line: merges prepare the next Stable version and the maintainer sets cadence by merging the release PR. There is no rolling Beta and no maintenance branch. Open a Beta/Alpha line (for example `1.2.0-beta.1`) only by explicit dispatch for a risky minor or a new major train, and only when it is expected to be promoted within about a week; while it is open, Stable fixes ship through that prerelease and its promotion.

## Platform trust

- macOS Developer ID signing and notarization block `1.0.0` and must run before the first RC. The identity is an individual Apple Developer membership; changing the signing team later can force a manual macOS reinstall.
- The first signed macOS build likely needs a one-time manual reinstall from unsigned builds; ship it during Beta.
- Windows signing is post-v1 (#49). Linux AppImage is not signed.

## Update channels

User-selectable Update channels are exactly Stable, Beta, and Alpha. RC is not a separate channel.

```txt
Stable -> stable
Beta   -> beta, rc, stable
Alpha  -> alpha, beta, rc, stable
```

- The app selects the newest eligible non-downgrade release itself (`src/main/update-feed.ts`) and points a generic feed at that release; release packaging writes the metadata aliases each eligible channel reads.
- Channel changes affect future updates only and never permit a downgrade.
- The desktop app, `openwaggle update`, and `install.sh` share one saved Update channel. Exact versions are one-time installs.
- A build with no saved choice defaults to its own prerelease stream; an RC build defaults to Beta.
- Switching into Alpha requires confirmation every time.
- Build channel (installed artifact) and Update channel (saved preference) are separate; never infer the Update channel from the installed version once a choice exists.

## Update restart and relaunch

- Check automatically; download in the background; installing is always a user action.
- An update restart never silently interrupts an agent run. With active runs anywhere in the Session Host, offer **Restart when idle** (default), **Restart now**, and **Cancel**. Restart when idle waits with no timeout and counts runs started later; the update action shows how many runs it waits for and keeps **Restart now** available. Restart now records runs as interrupted.
- With no active runs, restart immediately without a dialog.
- Restart now stops active runs and compactions through normal cancellation (30 s settle wait) before installing; the Session Host is released through its existing drain and handoff. Restart when idle survives update re-checks.
- Install with `quitAndInstall(isSilent: true, isForceRunAfter: true)`, following `pingdotgg/t3code`: silent on Windows, relaunch on every platform.
- Re-read the authoritative Update channel before installing.
- Fresh installs: NSIS launches the app; the macOS `.dmg` stays drag-to-Applications (no `.pkg`); `install.sh` launches the app unless there is no graphical session or `--no-launch` is passed, quitting the running desktop window (the `Foreground` process; the Session Host is `UIElement`) first; `openwaggle update` never installs under a running desktop app (a channel update defers to Restart to update, an exact `--version` refuses) and never opens a window; on macOS it installs through the bundled installer because Squirrel.Mac always relaunches.

## GitHub Releases

- Prereleases are GitHub prereleases. Only plain `X.Y.Z` app releases may be the repository's "Latest" release; package releases use `--latest=false` (#261).
- Never retag a prerelease or edit a GitHub release to simulate promotion.
- Fail closed when version, tag, release classification, or update metadata is inconsistent.

## Implementation guidance

- Keep pure version parsing, eligibility, and selection logic free of Electron and covered by unit tests.
- Keep Electron updater integration in main-process code behind typed IPC; renderer components use typed preload APIs.
- Validate runtime data at boundaries with shared schema helpers.
- Release workflow changes need their contract tests (`app-release-workflow` tests) updated in the same change.
- Run Electron QA after renderer, preload, IPC, or updater changes.

## Do not do

- Do not add release-intent files or a `release:none` classification.
- Do not publish Beta or RC builds to Stable users, or Alpha builds to Beta users.
- Do not support downgrades.
- Do not promote Stable from content that differs from the last RC.
- Do not open a rolling Beta or maintenance branch without a new decision.
- Do not create a side-by-side Canary app without a new decision.
- Do not require scripts or manual downloads as the primary Beta/Alpha opt-in UX.
- Do not make a release decision without running `grill-with-docs`.
