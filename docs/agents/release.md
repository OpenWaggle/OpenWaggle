# Agent Release Context

Use this file for agent-facing release and update-track decisions. The canonical release reference is `docs/release-and-versioning.md`.

## Current Release Model

OpenWaggle uses semver prerelease stages. The current release train is `0.3.0-alpha.N`.

Release automation is GitHub-based:

- CI runs typecheck, lint, and tests on PRs and pushes to `main`.
- Release workflow derives version bumps from Conventional Commit-style release-eligible commits.
- Release workflow updates `package.json`, creates a tag, builds platform artifacts, publishes a GitHub Release, and attaches checksums.

Published artifacts are currently unsigned. macOS notarization and Windows signing are release/distribution trust work, not routine implementation tasks.

## When To Load The Release Skill

Load `.agents/skills/release/SKILL.md` before changing:

- versioning
- release workflow
- updater behavior
- release notes
- installer packaging
- alpha/beta/stable track behavior
- signing, notarization, or platform distribution

## Release Notes

Until release-intent files exist, product-impacting PRs should include reviewer-facing release notes in the PR body:

- user-visible feature or behavior changes
- relevant docs updates
- validation evidence
- known remaining scope or follow-up work

Do not rely on commit subjects alone for large product changes such as Session Tree, branch lifecycle, resource precedence, provider/auth behavior, Waggle mode, or updater behavior.

## Validation

Use `.agents/verification.md` for baseline validation. For release work, prefer exact CI artifacts where possible. Post-publish installer checks are too late to prevent shipping broken installers.

## Npm Package Release Workflow

OpenWaggle npm packages use Release Please manifest mode through `release-please-config.json`, `.release-please-manifest.json`, and `.github/workflows/package-release.yml`.

- Release Please owns package-local version PRs, package-local `CHANGELOG.md` files, package-specific GitHub Releases, and short component tags such as `extension-sdk-v0.1.0`.
- `@openwaggle/extension-react` is dependency-bumped when `@openwaggle/extension-sdk` changes, and `@openwaggle/pi-waggle` is dependency-bumped when `@openwaggle/waggle-core` changes, via the Release Please `node-workspace` plugin.
- Manual `workflow_dispatch` is validation-only. It must not stage or publish packages.
- Real package staging runs only after Release Please creates package releases from a `main` push. The staging job requires GitHub OIDC with `id-token: write`, verifies the version is unpublished, and uses `npm stage publish` for maintainer approval.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, direct `npm publish`, or local maintainer publish fallback paths.
- Publishing remains blocked until maintainers own/configure the `@openwaggle` npm namespace, trusted publishing, stage-only permissions, and the protected `npm` environment.

For package release workflow changes, run `pnpm package-release:validate`, `pnpm check`, package build/pack dry-runs, and a Release Please dry-run where credentials allow it.
