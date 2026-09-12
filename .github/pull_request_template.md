## Summary

Describe the user or maintainer-facing change and its validation.

## Package Release Semantics

The pull request title must use an allowed Conventional Commit subject (for example, `feat(extension-sdk): expose manifest helpers`). GitHub uses that title for squash commits, so CI validates it in addition to the branch commit history.

Package versions are driven only by release-eligible Conventional Commits that touch the relevant `packages/<name>/**` path. `feat` produces a package minor, `fix` a patch, and `!` or a `BREAKING CHANGE:` footer marks a breaking package change. Changes limited to the desktop app, website, general docs, fixtures, or workflows do not directly release an npm package.

Desktop app releases currently use release-eligible Conventional Commit subjects to open a human-gated version PR, then publish GitHub-generated release notes after that PR is merged. Release-intent files and a generated root changelog are planned but not implemented. Until they are, describe user-facing changes, validation, and remaining scope in this PR body.

## Mixed PRs

Squash this PR when one Conventional Commit accurately describes its complete intent. Preserve separate Conventional Commits when app, package, or multiple package changes have distinct release impacts, especially when the package path-scoped intent differs from the app change.

## Validation

- [ ] `pnpm verify` (pre-push baseline; the hook runs it automatically)
- [ ] `pnpm check`
- [ ] Relevant tests
- [ ] Package checks when a publishable package changed
- [ ] Regenerated `e2e/visual-regression.e2e.test.ts-snapshots/` and reviewed the diff when rendered pixels changed (CI macOS runners are the source of truth for baselines)
