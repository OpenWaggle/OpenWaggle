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

- This workflow is separate from the desktop app release workflow. Package versions use path-scoped Conventional Commits; app versions use app release-intent files.
- Release Please owns one coordinated package release PR, package-local `CHANGELOG.md` files, package-specific GitHub Releases, and short component tags such as `extension-sdk-v0.1.0`.
- Only release-eligible commits that touch `packages/<name>/**` directly release that package. Changes limited to the app, website, general docs, fixtures, or workflows do not publish npm packages.
- Pull request titles must be Conventional Commit subjects so squash merges retain package release intent. Repository policy disables merge commits and preserves squash and rebase: squash a one-intent PR, and rebase a mixed-intent PR when separate commits carry distinct release impacts. Reverts use `revert(scope): ...` rather than generated `Revert "..."` subjects.
- `@openwaggle/extension-react` is dependency-bumped when `@openwaggle/extension-sdk` changes, and `@openwaggle/pi-waggle` is dependency-bumped when `@openwaggle/waggle-core` changes, via the Release Please `node-workspace` plugin.
- Merging the Release Please PR is the explicit release gate. The workflow then validates and publishes exact tarballs through npm Trusted Publishing with `id-token: write` and automatic provenance.
- Publish `extension-sdk` and `waggle-core` before `extension-react` and `pi-waggle`, respectively.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `npm stage publish`, or a local fallback for real package versions.
- Manual recovery dispatch is allowed only for one exact canonical package tag. It must check out, validate, and publish that tag's missing package version without replacing an existing artifact.
- All packages require Node.js `>=22.19.0`. Release validation covers Node 22.19+ and Node 24; publication uses Node 24 and pinned npm `11.18.0` until deliberately updated.
- The one-time `pnpm package-release:bootstrap --execute` path may publish deprecated `0.0.0-bootstrap.0` namespace placeholders under the `bootstrap` dist-tag, configure `npm trust`, and disable token publication. It must never publish a real package version.
- Bootstrap verifies repository merge settings and fails compatibility when they drift. Execution patches only `allow_merge_commit=false`, `allow_squash_merge=true`, and `allow_rebase_merge=true`, then reads the settings back before continuing.
- Bad published versions are deprecated and replaced with a new patch; they are not overwritten or routinely unpublished.

For package release workflow changes, run `pnpm package-release:validate`, `pnpm check`, package build/pack checks, API snapshot checks, packed consumer smoke tests, and a Release Please dry-run where credentials allow it.
