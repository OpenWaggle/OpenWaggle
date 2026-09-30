## Summary

Describe the user or maintainer-facing change and its validation.

## Package Release Semantics

The pull request title must use an allowed Conventional Commit subject (for example, `feat(extension-sdk): expose manifest helpers`). GitHub uses that title for squash commits, so CI validates it in addition to the branch commit history.

Package versions are driven only by release-eligible Conventional Commits that touch the relevant `packages/<name>/**` path. `feat` produces a package minor, `fix` a patch, and `!` or a `BREAKING CHANGE:` footer marks a breaking package change. Changes limited to the desktop app, website, general docs, fixtures, or workflows do not directly release an npm package.

Desktop app releases use release-eligible Conventional Commit subjects to open a human-gated version PR (ADR 0040). Prereleases publish GitHub-generated release notes; Stable releases publish their hand-written `CHANGELOG.md` entry. A change that breaks a covered surface needs a `!` title. Describe user-facing changes, validation, and remaining scope in this PR body so the Stable changelog can be written from it.

## Mixed PRs

Squash this PR when one Conventional Commit accurately describes its complete intent. Preserve separate Conventional Commits when app, package, or multiple package changes have distinct release impacts, especially when the package path-scoped intent differs from the app change.

## Validation

- [ ] `pnpm verify` (pre-push baseline; the hook runs it automatically)
- [ ] `pnpm check`
- [ ] Relevant tests
- [ ] Package checks when a publishable package changed
