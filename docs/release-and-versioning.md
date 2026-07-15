# Release, Versioning & CI/CD

## Git Hooks

Husky is configured with a `pre-push` hook that runs only when pushing to `main`:

- `pnpm check`
- `pnpm format`
- `pnpm test:all` (includes headless Playwright e2e)

## CI/CD

Every push to `main` and every PR runs CI for typechecking, linting, and tests. The current release workflow is still Conventional Commit derived: when release-eligible commits land on `main`, CI determines the version bump and opens a generated version PR. GitHub creates that PR's CI in approval-required state because the PR uses `GITHUB_TOKEN`; the release workflow reruns that PR-associated run for the exact head, waits for all required checks, and squash-merges through normal `main` protection. If `main` advances, it updates the release branch and repeats exact-head CI before retrying the merge. The same run verifies the protected merge SHA and version, pushes only its tag, builds platform artifacts, and publishes a GitHub Release with checksums. Reruns adopt compatible existing release branches, PRs, protected merge commits, and tags while rejecting conflicting state.

The workflow currently publishes unsigned platform artifacts. Public distribution still depends on platform trust work such as macOS notarization and Windows code signing.

## Versioning

OpenWaggle uses semver with prerelease stages. The current release train is `0.3.0-alpha.N`.

| Stage | Example Version | What Happens On Release |
|-------|-----------------|-------------------------|
| Alpha | `0.3.0-alpha.N` | Increments `alpha.N+1` on release-eligible changes. |
| Beta | `0.3.0-beta.N` | Increments `beta.N+1` after the project moves to beta. |
| Stable | `0.3.0` | `fix:` increments patch, `feat:` increments minor, breaking changes increment major. |

To transition stages, manually set the version in `package.json` and commit as `chore(release): <message>`.

### Protected release recovery

The failed `0.3.0-alpha.44` direct-push attempt created a remote tag whose commit never reached protected `main`. Recovery intentionally sets the root version on `main` to `0.3.0-alpha.44` in a `chore(release):` reconciliation commit. That subject skips both release-PR generation and tag publication. The existing orphan tag is preserved for auditability; the next release-eligible change increments the reconciled root version and publishes `0.3.0-alpha.45` from a version PR that passed exact-head CI. Do not delete, move, or reuse the orphan tag.

## Release Notes

Release intent metadata is planned but not implemented yet. Until committed release-intent files exist, product-impacting PRs should include reviewer-facing release notes in the PR body:

- User-visible feature or behavior changes.
- Relevant docs updates.
- Validation evidence.
- Known remaining scope or follow-up work.

Do not rely on commit subjects alone for large product changes such as Session Tree, branch lifecycle, resource precedence, or provider/auth behavior.

## Npm Package Publishing

OpenWaggle has a separate npm package publishing workflow for public package APIs. This workflow is distinct from the desktop app release train and does not use the root app version.

The first publishable package set is:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-react`
- `@openwaggle/waggle-core`
- `@openwaggle/pi-waggle`

### Package release safety contract

Package releases fail before merge. Every pull request reports an always-present `Package Release Gate` and performs the complete release rehearsal on the exact pull request head: Node.js `22.19.0` and `24`, npm/pnpm/Yarn/Bun consumers, ESM/CommonJS/browser imports, tarball allowlists and metadata, generated package docs, public API compatibility, and installed-agent docs.

The Release Please pull request is the final release candidate. Its green gate builds each final-version tarball once, records the Git tree identity and SHA-256 digest, and uploads the immutable artifacts with GitHub provenance. Merging that pull request is an explicit maintainer decision; release pull requests are never auto-merged and repository rules have no routine release bypass.

After merge, publication must not rebuild, regenerate docs, or rerun quality checks. The publish workflow resolves the successful release-candidate artifact for the merged Git tree, verifies its provenance against `.github/workflows/ci.yml` and the selected source SHA and workflow run, verifies tree identity, digest, package/version plan, OIDC identity, dependency availability, and unpublished npm state, then publishes that exact tarball through npm Trusted Publishing. Every npm integrity and dependency observation uses bounded retries for transient registry/network failures only; deterministic content or response failures fail immediately and belong in the pre-merge gate.

Publish bases before dependents. A release plan that changes `@openwaggle/extension-sdk` must also release `@openwaggle/extension-react`, and a plan that changes `@openwaggle/waggle-core` must also release `@openwaggle/pi-waggle`; base-only plans fail before artifact preparation or promotion. After npm accepts and serves the exact version, create the immutable package tag and only then publish the matching GitHub Release. A GitHub Release must never claim availability before npm does.

The website guide under `website/src/content/docs/packages/<package>/<major>.<minor>/` is the canonical published package documentation. Published lines remain immutable; authors prepare a future line under `website/src/content/package-docs-next/<package>/`. `pnpm package-docs:update` generates committed package READMEs and current API-reference pages; `pnpm check` fails on drift. When Release Please crosses a major.minor boundary, its workflow promotes that pending source into the resolved version directory, removes the pending source, commits the result to the release branch, and validates that exact head. Package READMEs are self-contained npm landing pages with four tested package-manager commands and absolute documentation/support links. Installed agent docs expand website-only components into ordinary Markdown from the same source.

Package documentation uses exact `major.minor` lines, keeps historical lines immutable, and exposes an unversioned latest alias. A canonical docs change that changes a generated README, API reference, package metadata, install guidance, or supported public contract requires at least a patch release for the affected package. Website-only editorial changes that do not alter generated package surfaces do not release an npm package. Internal API snapshot tooling remains a compatibility gate and is not user-facing documentation.

GitHub uses the pull request title for the squash commit consumed by Release Please. Any pull request that changes `packages/**` therefore needs a release-producing `fix`, `feat`, or `revert` title. CI rejects package-changing `docs`, `chore`, or `refactor` titles that would silently skip the required version bump; generated Release Please titles remain exempt.

These packages use the MIT license, independent semver versions, Node.js `>=22.19.0`, and a shared Release Please package workflow. Initial public versions start at `0.1.0` and publish to npm's default `latest` dist-tag. `@openwaggle/pi-waggle` depends on `@openwaggle/waggle-core` and receives a dependent package patch bump whenever Waggle core changes. `@openwaggle/extension-react` depends on `@openwaggle/extension-sdk` and receives a dependent package patch bump whenever the extension SDK changes. A dependent package's own release intent may raise that bump.

`@openwaggle/extension-react` must not bundle React. It declares `react` and `react-dom` as peer dependencies with initial ranges of `^19.0.0`, while `@openwaggle/extension-sdk` is a normal dependency that publishes as a caret semver range. The package should also list React, React DOM, and their type packages as package-local dev dependencies for build and test coverage; those dev dependencies must not appear in the published runtime dependency graph.

`@openwaggle/pi-waggle` must not publish wildcard Pi peer dependencies. It declares explicit Pi peer ranges for the Pi API line it was built against. The initial ranges are `@earendil-works/pi-coding-agent: ^0.80.6` and `@earendil-works/pi-tui: ^0.80.6`, with exact package-local dev dependencies on `0.80.6` for build and test coverage.

`@openwaggle/waggle-core` must remain runtime-neutral reusable policy. It must not import Pi SDK packages, Electron, Node built-ins, OpenWaggle renderer stores, or app services. Pi-specific bindings, renderers, commands, and extension registration belong in `@openwaggle/pi-waggle`.

Package import boundaries must be enforced by repository standards checks that run under `pnpm check`. The checks should fail if `packages/extension-sdk/**` imports Electron, Node built-ins, Pi SDK packages, renderer stores, or main-process services; if `packages/waggle-core/**` imports Pi SDK packages, Electron, Node built-ins, renderer stores, or app services; if `packages/extension-react/**` imports OpenWaggle renderer components or app CSS/Tailwind internals; or if `packages/pi-waggle/**` imports Electron, renderer stores, or app services.

All public package source lives under `packages/*`. The first package directories are `packages/extension-sdk`, `packages/extension-react`, `packages/waggle-core`, and `packages/pi-waggle`. Each package owns its `src/` API source, emits built JavaScript and TypeScript declarations to package-local output, and publishes from its package directory. Do not create parallel package copies outside `packages/*`, and do not publish raw TypeScript source as the runtime contract.

Package builds should follow the `ts-match` plain TypeScript model by default: TypeScript project builds emit ESM output, CommonJS output, and declarations without bundling. Use package-local output directories such as `dist/` for ESM and declarations plus `dist-cjs/` for CommonJS, with a `dist-cjs/package.json` that marks the CommonJS subtree as `type: commonjs`. Do not introduce tsup, Rollup, Vite library mode, or dependency bundling unless a package has a documented reason to diverge.

Public imports are limited to each package's explicit `package.json` exports. Documented top-level and subpath exports are supported; deep imports into `src/`, `dist/`, `dist-cjs/`, or other internal files are not part of the public contract. Export smoke tests should validate every documented export and reject accidental reliance on private deep paths.

`@openwaggle/extension-sdk` should export public Effect Schema boundary values directly for manifests, contributions, broker payloads, docs discovery, and agent-loop DTOs. It should also provide helper APIs for common workflows such as defining and validating extension manifests so beginner authoring does not require direct Effect Schema usage. Effect Schema is the primary runtime schema contract for `0.1.0`; JSON Schema may be generated later as an additional artifact, but it should not replace the canonical Effect Schema boundary in the first release.

`@openwaggle/extension-sdk` must remain browser-safe. It must not import Electron, Node built-ins, OpenWaggle main-process services, renderer stores, or Pi SDK packages. Runtime helpers should operate on the brokered SDK/context values passed to extension mount code rather than reaching into host internals.

Package manifests should declare side-effect metadata explicitly. `@openwaggle/extension-sdk`, `@openwaggle/waggle-core`, and `@openwaggle/pi-waggle` use `"sideEffects": false`. `@openwaggle/extension-react` uses `"sideEffects": ["./styles.css"]` so bundlers can tree-shake component code without dropping the stylesheet export.

Every OpenWaggle publishable package must declare `publishConfig.access: "public"` so scoped package access is explicit and tarball validation can reject private-by-default ambiguity.

Package tarballs should include only the publishable contract:

- `dist/**`
- `dist-cjs/**`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`
- `styles.css` for `@openwaggle/extension-react` when emitted or copied as an exported package asset

Package tarballs should exclude repository and development artifacts:

- `src/**`
- `__tests__/**`
- development fixtures
- `tsconfig*.json`
- local scripts
- `.openwaggle/**`
- build caches
- generated source maps unless a later package decision explicitly enables them

Package validation should include API surface snapshots for every publishable package. Snapshot checks should compare the committed public TypeScript declaration surface against the newly built package output so unintended public API changes fail before publish. Prefer API Extractor-style declaration reports if they work cleanly with the four package outputs; otherwise use a deterministic repository-owned declaration snapshot script. In either case, `pnpm check` should fail on snapshot drift unless the snapshot update is intentionally committed in the same PR. Export smoke tests and package manager smoke tests still run; the API snapshot is the compatibility guard for the declaration shape.

The first explicit export maps should be minimal:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-sdk/manifest`
- `@openwaggle/extension-sdk/broker`
- `@openwaggle/extension-sdk/runtime`
- `@openwaggle/extension-sdk/theme`
- `@openwaggle/extension-sdk/ui`
- `@openwaggle/extension-sdk/agent-loop`
- `@openwaggle/extension-sdk/docs`
- `@openwaggle/extension-react`
- `@openwaggle/extension-react/styles.css`
- `@openwaggle/waggle-core`
- `@openwaggle/waggle-core/config`
- `@openwaggle/waggle-core/consensus`
- `@openwaggle/waggle-core/events`
- `@openwaggle/waggle-core/presets`
- `@openwaggle/waggle-core/prompts`
- `@openwaggle/waggle-core/state`
- `@openwaggle/waggle-core/turn-policy`
- `@openwaggle/pi-waggle`
- `@openwaggle/pi-waggle/commands`
- `@openwaggle/pi-waggle/extension`
- `@openwaggle/pi-waggle/loop`
- `@openwaggle/pi-waggle/mode-state`
- `@openwaggle/pi-waggle/preset-storage`
- `@openwaggle/pi-waggle/presets`
- `@openwaggle/pi-waggle/protocol`
- `@openwaggle/pi-waggle/renderers`
- `@openwaggle/pi-waggle/stop-policy`

Adding, removing, or changing a public export path is a package-contract change and must be reflected in semver and package release notes.

The first public publish uses the maintainer-owned `@openwaggle` npm organization scope. Do not publish these packages under a temporary personal scope.

Package publishing should follow the `ts-match` release model:

- Release Please manifest mode maintains one coordinated package version PR while packages retain independent versions.
- Merging that Release Please PR is the explicit release gate. Tagging, GitHub Releases, validation, and npm publication are automatic after the merge.
- Each package owns its package-local changelog.
- Package-specific tags identify published versions. Use short package-name tags: `extension-sdk-v0.1.0`, `extension-react-v0.1.0`, `waggle-core-v0.1.0`, and `pi-waggle-v0.1.0`. Do not include the npm scope in Git tag names.
- Each released package gets its own GitHub Release, matching its package tag and changelog, even when multiple packages are released from the same Release Please PR.
- `fix` produces a patch, `feat` produces a minor, and a breaking change produces a minor while the package is below `1.0.0`; after `1.0.0`, a breaking change produces a major.
- Direct package release intent is package-impact scoped. Release Please considers release-eligible Conventional Commits that touch `packages/<name>/**` or change that package's generated README/API/metadata source. App, unrelated website pages, general documentation, fixtures, and workflow-only changes do not release npm packages.
- Conventional Commit validation starts at the package-release bootstrap baseline and applies to every authored commit landing on `main`. Pull request titles must also be valid Conventional Commit subjects because GitHub uses them as squash commit subjects.
- Generated merge subjects are accepted only when the merge does not change a publishable package. A merge that changes `packages/*` must carry explicit Conventional Commit release intent. Generated `Revert "..."` subjects are not exempt; use an explicit subject such as `revert(extension-sdk): restore the previous manifest contract`.
- Repository settings disable merge commits while preserving squash and rebase. Squash a one-intent PR with a Conventional Commit title. Rebase a mixed-intent PR when its app and package changes need separate Conventional Commits or different package release impacts.
- The Release Please `node-workspace` plugin patch-bumps and updates a dependent package when its OpenWaggle dependency releases.
- Packages ship built dual output from plain TypeScript builds: ESM, CommonJS, and TypeScript declarations. Package source and consumer-smoke fixtures remain TypeScript; CommonJS compatibility is exercised from TypeScript with Node's `createRequire`, and `.js`/`.cjs` files exist only as ignored compiler output or published artifacts.
- Pre-merge validation builds packages, checks every documented export boundary, checks public API snapshots, enforces a strict tarball allowlist, smoke-installs packed tarballs through npm, pnpm, Yarn, and Bun on Node 22.19+ and Node 24, and attests the exact validated release-candidate tarballs. Post-merge publication only verifies and promotes those artifacts.
- Publishing uses direct `npm publish <tarball>` through npm Trusted Publishing from GitHub Actions with `id-token: write`. Trusted Publishing supplies provenance automatically.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `npm stage publish`, or a local maintainer fallback for real package versions.
- Publish `extension-sdk` and `waggle-core` before `extension-react` and `pi-waggle`, respectively, and verify each base version is resolvable before publishing its dependent.
- The release job runs on Node 24 with pinned npm `11.18.0` until that pin is deliberately updated. Do not install `npm@latest` during a release.
- The protected GitHub `npm` environment has no npm secrets or required reviewers, accepts deployments only from `main`, and prevents concurrent package release runs.
- The additive `main` ruleset requires pull requests and current green CI, allows only squash and rebase, and blocks force pushes and deletion without a routine bypass. Release Please package PRs remain open until a maintainer or explicitly authorized agent chooses to merge them. Repository settings disable merge commits so GitHub cannot synthesize a package-changing merge subject that passes PR checks but fails the commit policy on `main`.
- Recovery reruns the failed Package Release workflow so it retains the original push identity and promotes the same attested release-candidate artifact. Publication resumes only missing package versions whose registry integrity still matches and never rebuilds or replaces an existing version.
- A bad published version is deprecated and followed by a corrected patch. Do not overwrite or routinely unpublish immutable package history.
- Normal package releases are stable semver versions published to `latest`. The workflow does not support `next`, `beta`, or `rc` channels until a separate prerelease policy is accepted; the setup-only `bootstrap` tag is the sole exception.
- Package-only publishing does not require full desktop app release validation unless the same change touches app behavior.
- Packages stay in the OpenWaggle monorepo for the first public releases. `@openwaggle/waggle-core` should remain extraction-friendly and may move to its own repository later only if real adoption or contributor pressure justifies the cross-repository release overhead.
- Each package ships a committed generated package-local README for npm/GitHub consumers, while openwaggle.ai remains the canonical authored source for install instructions, import paths, examples, API surface, and links between related packages. User-facing package docs and package READMEs do not explain API snapshot tooling or internal release workflow; those remain internal validation and release artifacts.
- The OpenWaggle app consumes monorepo packages through `workspace:*`. Published package manifests must resolve workspace dependencies to caret semver ranges for the released dependency version, such as `^0.1.0`, during packing/publishing. Tarball smoke tests must prove those manifests work outside the workspace.

### One-Time Namespace Bootstrap

npm Trusted Publishing can only be configured after a package record exists. The repository therefore provides one resumable bootstrap command with two modes:

```bash
pnpm package-release:bootstrap
pnpm package-release:bootstrap --execute
```

The default mode is read-only and reports every intended registry and GitHub change. `--execute` requires a clean, up-to-date `main`, authenticated npm and GitHub sessions, npm 2FA, and pinned npm `11.18.0` or a deliberately approved newer version.

npm does not provide a reliable read API for the per-package `mfa=publish` policy. Read-only preflight therefore reports that policy as unverified and pending rather than claiming the package is fully compatible. Execution safely reasserts `mfa=publish` for every package on each run.

The execution mode:

1. Runs full package validation before changing external state.
2. Publishes minimal `0.0.0-bootstrap.0` package records under the non-default `bootstrap` dist-tag. npm also assigns `latest` when the first package record is created and does not allow that sole-version tag to be removed.
3. Sets package publishing access to `mfa=publish`, which requires interactive 2FA and disallows automation-token publication while retaining OIDC publishing.
4. Deprecates the bootstrap placeholder before configuring trust. The first trusted `0.1.0` publish replaces `latest` with the real release.
5. Configures and verifies each package with `npm trust github`, pinned to `OpenWaggle/OpenWaggle`, `package-release.yml`, environment `npm`, and direct publish permission only.
6. Creates or verifies the GitHub `npm` environment and additive `main` ruleset with only the administrator emergency bypass, then enforces merge commits off with squash and rebase on. The repository update sends only those three merge-mode fields and verifies the resulting state, so unrelated repository settings are not overwritten.

The one-time bootstrap kept source manifests at an unpublished baseline until the canonical `0.1.0` Release Please PR. All four source manifests are now `0.1.0`, and subsequent real versions are maintained by coordinated Release Please PRs and published by CI with provenance.

Responsibility split:

- OpenWaggle code owns package metadata, package build scripts, pack/smoke validation, Release Please configuration, GitHub Actions workflows, bootstrap automation, repository policy validation, and package author documentation.
- Maintainers own the `@openwaggle` organization, npm and GitHub authentication, npm 2FA, execution of the one-time bootstrap command, review/merge of Release Please PRs, and final license confirmation.

Do not publish development extension fixtures, installed QA copies, the website package, or root desktop app artifacts through the npm package workflow.

Packaged app QA for extension authoring must still prove that installed builds discover user-authored packages from both supported roots:

- project-local `<project>/.openwaggle/extensions/<extension-id>/`
- global app-data `extensions/<extension-id>/`

Development fixtures may be copied into those roots for QA, but they must not be shipped as production content or preinstalled extensions.
