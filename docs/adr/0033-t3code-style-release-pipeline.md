# t3code-Style Release Pipeline

Status: proposed

Supersedes ADR 0029 (Tier CI Gates Behind a Merge Queue).

Releasing a single feature drove the full test matrix ~5 times: the PR run, the merge-queue `merge_group` run, the post-merge `push: main` run, the release-please `chore(release)` PR run, and the post-merge run when that release PR landed. The same unit/integration/typecheck/lint/E2E work re-ran on an unchanged (or near-unchanged) tree, and the heavy cross-platform installer build was dragged into the per-feature loop through release-please. Iteration felt slow out of proportion to the change.

We adopt the model `pingdotgg/t3code` uses: CI is a lean per-change gate, and releasing is a deliberate, decoupled event. This is a faithful adaptation of t3code's `ci.yml` and `release.yml` structure to OpenWaggle's toolchain (pnpm + electron-builder), minus code signing/notarization and minus t3-specific jobs OpenWaggle has no analogue for (Rust, mobile/EAS, server shards, relay/Clerk, CLI publish, AUR, web deploy, Discord).

## Decision

- `ci.yml` runs on `pull_request` and `push: main`, with no merge queue. Jobs: `Check` (`pnpm check`), `Test` (`pnpm test:unit && pnpm test:integration && pnpm test:component`), and `Release Smoke` (`pnpm build`). A feature triggers one PR run plus one main run.
- `release.yml` runs only on a pushed `v*` tag (stable), a nightly `schedule` (every 3 hours, guarded by `check_changes`), or `workflow_dispatch`. It resolves the version from the tag/dispatch input (stable) or computes a `-nightly.<date>.<run>` version, runs a release quality gate, builds the macOS/Linux/Windows installers with electron-builder, publishes the GitHub release, and (stable only) bumps `main` back to the released version.

## Considered Options

- **Keep the merge queue and only drop the redundant `push: main` re-run** — smaller change, keeps main always-green, but retains release-please's per-feature release-PR churn, which is the larger source of duplicate runs.
- **Keep ADR 0029 as-is** — main is provably green at merge, but the ~5x per-feature run cost and slow iteration are exactly what this decision removes.

## Consequences

- Main can briefly go red from a semantic conflict between two independently-green PRs; there is no speculative merge validation. This is the t3code trade-off, accepted for a fast-moving alpha.
- Electron E2E, MCP conformance, commit policy, and package/website rehearsals no longer run per PR. Coverage moves to the release quality gate and `Release Smoke`; the maintainer can add back any of these as `ci.yml` jobs if a gap bites.
- Releases are no longer automatic on merge. To cut a release you push a `v*` tag or dispatch the workflow; nightlies ship automatically from `main` when there are changes.
- The branch ruleset must drop the `merge_queue` rule and require the new check names (`Check`, `Test`, `Release Smoke`) instead of the old ones. `finalize` pushes the stable version bump with the built-in `GITHUB_TOKEN`, which requires a `github-actions` bypass actor on the `main` ruleset.
- Code signing/notarization is intentionally omitted (OpenWaggle does not sign today); electron-builder runs with `CSC_IDENTITY_AUTO_DISCOVERY: false`.
