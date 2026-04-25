# Release, Versioning & CI/CD

## Git Hooks

Husky is configured with a `pre-push` hook that runs only when pushing to `main`:

- `pnpm check`
- `pnpm format`
- `pnpm test:all` (includes headless Playwright e2e)

## CI/CD

Every push to `main` and every PR runs CI (typecheck, lint, tests). Releases are fully automated — push a `feat:` or `fix:` commit to `main` and CI will:

1. Determine the version bump from Conventional Commits
2. Bump `package.json`, commit, and tag
3. Build for macOS (arm64 + x64), Windows, and Linux in parallel
4. Create a GitHub Release with all artifacts + SHA256 checksums

No manual tag creation or version editing is needed for normal `feat:`/`fix:` releases. The workflow currently publishes unsigned platform artifacts; public distribution still depends on platform trust work such as macOS notarization and Windows code signing.

## Versioning

OpenWaggle uses semver with prerelease stages. During alpha/beta, every `feat:` or `fix:` push increments the counter (`alpha.1` → `alpha.2`). After going stable, standard semver bumps apply.

| Stage | Version | What happens on each push |
|-------|---------|--------------------------|
| Alpha | `0.2.0-alpha.N` | Increments `alpha.N+1` |
| Beta | `0.2.0-beta.N` | Increments `beta.N+1` |
| Stable | `0.2.0` | `fix:` → `0.2.1`, `feat:` → `0.3.0`, breaking → `1.0.0` |

To transition stages, manually set the version in `package.json` and commit as `chore(release): <message>`.
