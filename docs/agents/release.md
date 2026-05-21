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
