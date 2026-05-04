# Release, Versioning & CI/CD

## Git Hooks

Husky is configured with a `pre-push` hook that runs only when pushing to `main`:

- `pnpm check`
- `pnpm format`
- `pnpm test:all` (includes headless Playwright e2e)

## CI/CD

Every push to `main` and every PR runs CI for typechecking, linting, and tests. The current release workflow is still Conventional Commit derived: when release-eligible commits land on `main`, CI determines the version bump, updates `package.json`, creates a tag, builds platform artifacts, and publishes a GitHub Release with checksums.

The workflow currently publishes unsigned platform artifacts. Public distribution still depends on platform trust work such as macOS notarization and Windows code signing.

## Versioning

OpenWaggle uses semver with prerelease stages. The current release train is `0.3.0-alpha.N`.

| Stage | Example Version | What Happens On Release |
|-------|-----------------|-------------------------|
| Alpha | `0.3.0-alpha.N` | Increments `alpha.N+1` on release-eligible changes. |
| Beta | `0.3.0-beta.N` | Increments `beta.N+1` after the project moves to beta. |
| Stable | `0.3.0` | `fix:` increments patch, `feat:` increments minor, breaking changes increment major. |

To transition stages, manually set the version in `package.json` and commit as `chore(release): <message>`.

## Release Notes

Release intent metadata is planned but not implemented yet. Until committed release-intent files exist, product-impacting PRs should include reviewer-facing release notes in the PR body:

- User-visible feature or behavior changes.
- Relevant docs updates.
- Validation evidence.
- Known remaining scope or follow-up work.

Do not rely on commit subjects alone for large product changes such as Session Tree, branch lifecycle, resource precedence, or provider/auth behavior.
