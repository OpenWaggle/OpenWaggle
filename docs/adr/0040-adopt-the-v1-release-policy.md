# Adopt the v1 Release Policy

Status: accepted

Refines ADR 0032 (Coexisting Build Identities and Channel-Keyed Updates). Supersedes the release-intent design in PRD issue #90.

OpenWaggle had published only prerelease builds (`0.x-alpha.N`), and its docs disagreed about the target: the release docs planned a Stable `0.4.0`, while PRD #90 planned a governed `1.0.0` train with custom release-intent files. We are shipping v1, so we fixed the policy that the release workflow, updater, and docs must follow. The full rules live in `docs/release-and-versioning.md`.

## Decision

- **The first Stable release is `1.0.0`.** The `0.x` trains end without a Stable release. The `1.0.0` line starts at `1.0.0-beta.1`, ideally the first signed macOS build; there is no `1.0.0-alpha.N` stage, because the `0.x` alpha builds served that purpose.
- **Semver becomes a Compatibility promise at `1.0.0`.** Breaking a Covered surface (user data, the Sessions/Delegations/Access CLIs and their machine output, Session Control over the OpenWaggle MCP server, the Agent-definition schema, supported platforms) requires a major version. The extension host contract follows the extension SDK's own semver, and Pi-owned resources follow Pi; neither is covered by the app version.
- **Conventional Commits remain the app's release intent.** We do not build #90's `.release/changes/*` files or `release:none` classification. A breaking change needs a `!` title. Stable releases get a hand-written `CHANGELOG.md` entry reused as the GitHub Release notes; prereleases keep generated notes.
- **macOS signing and notarization block `1.0.0`** and must run before the first RC; the identity is an individual Apple Developer membership. Windows signing is post-v1.
- **RC reaches Beta and Alpha Update channels automatically**, so the RC validation window is exercised by real users.
- **One release line after `1.0.0`.** Merges prepare the next Stable version; a Beta/Alpha line opens only by explicit dispatch and should be promoted within about a week. There is no rolling Beta and no maintenance branch.
- **RC is frozen by a promotion guard.** Stable promotion fails closed unless `main` matches the last RC tag apart from the version and non-app paths.
- **Update restarts never silently interrupt agent runs.** With active runs, the user chooses Restart when idle (default), Restart now, or Cancel. Updates download in the background, install silently, and force a relaunch, following `pingdotgg/t3code`; `install.sh` launches the app after a desktop session install.

## Considered Options

- **Stable `0.4.0` before `1.0.0`** — rejected: two "first stable" moments, and a `0.x` Stable makes no compatibility promise.
- **#90's custom release-intent system** — rejected for v1: a second classification layer beside the Conventional Commits that Commit Policy already enforces, and it still relies on a human classifying breaks correctly. A CI check that fails when a covered-surface contract changes without a `!` title is the planned post-v1 guard instead.
- **Rolling Beta or Chrome-style trains after v1** — rejected: urgent Stable fixes would need maintenance branches and backports.
- **t3code-style promotion of the exact validated commit** — deferred: Stable's version commit would not be on protected `main`, which conflicts with the human-merged version-PR model (ADR 0033 kept it deliberately). The RC freeze guard gives the same-source guarantee with a small check.
- **t3code's update UX (click to download, always-confirm, no waiting)** — rejected in favour of background download and Restart when idle, which better protects agent work; t3code's rule of stopping running work before install is adopted as stopping active runs through normal cancellation.

## Consequences

- The release docs, release skill, ADR 0032, and `CONTEXT.md` Update-channel language must match this policy before the first RC.
- `main` is frozen for app code for at least the 7-day RC window.
- macOS users on unsigned builds will likely need one manual reinstall to reach the first signed build, planned during Beta.
- Changing the Apple signing team later may cost macOS users another manual reinstall.
