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

## Npm Package Publishing

OpenWaggle has a separate npm package publishing workflow for public package APIs. This workflow is distinct from the desktop app release train and does not use the root app version.

The first publishable package set is:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-react`
- `@openwaggle/waggle-core`
- `@openwaggle/pi-waggle`

These packages use the MIT license, independent semver versions, and a shared Release Please package workflow. Initial public versions start at `0.1.0` and publish to npm's default `latest` dist-tag. `@openwaggle/pi-waggle` depends on `@openwaggle/waggle-core` and receives a dependent package bump whenever Waggle core changes. `@openwaggle/extension-react` depends on `@openwaggle/extension-sdk` and receives a dependent package bump whenever the extension SDK changes.

`@openwaggle/extension-react` must not bundle React. It declares `react` and `react-dom` as peer dependencies with initial ranges of `^19.0.0`, while `@openwaggle/extension-sdk` is a normal dependency that publishes as a caret semver range. The package should also list React, React DOM, and their type packages as package-local dev dependencies for build and test coverage; those dev dependencies must not appear in the published runtime dependency graph.

`@openwaggle/pi-waggle` must not publish wildcard Pi peer dependencies. It declares explicit Pi peer ranges for the Pi API line it was built against. The initial ranges are `@earendil-works/pi-coding-agent: ^0.78.1` and `@earendil-works/pi-tui: ^0.78.1`, with exact package-local dev dependencies on `0.78.1` for build and test coverage.

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

The first public publish must use the `@openwaggle` npm organization scope. If npm reports the namespace as unavailable after a deleted account or prior ownership state, package publishing remains blocked until the maintainer unblocks or recovers that namespace with npm support. Do not publish these packages under a temporary personal scope.

Package publishing should follow the `ts-match` release model:

- Release Please manifest mode creates package version PRs.
- Each package owns its package-local changelog.
- Package-specific tags identify published versions. Use short package-name tags: `extension-sdk-v0.1.0`, `extension-react-v0.1.0`, `waggle-core-v0.1.0`, and `pi-waggle-v0.1.0`. Do not include the npm scope in Git tag names.
- Each released package gets its own GitHub Release, matching its package tag and changelog, even when multiple packages are released from the same Release Please PR.
- Packages ship built dual output from plain TypeScript builds: ESM, CommonJS, and TypeScript declarations.
- Publish validation builds packages, checks every documented export boundary, checks public API snapshots, checks tarball contents, smoke-installs packed tarballs through supported package managers where practical, verifies unpublished versions, and publishes tarballs with npm trusted publishing/provenance.
- Publishing requires npm trusted publishing from GitHub Actions. Do not add an `NPM_TOKEN` fallback and do not support local maintainer publish as an emergency path; publishing should fail closed until maintainer-side trusted publishing setup is complete.
- Release automation should use npm staged publishing for package releases. CI stages the validated tarball through trusted publishing, and a maintainer approves the staged package before it becomes publicly installable.
- Real package staging or publishing should run only from Release Please-created package release or tag events. Manual workflow dispatch is allowed for dry-run validation only and must not call `npm stage publish` or `npm publish`.
- Publish validation should fail before staging if GitHub OIDC/trusted publishing is not correctly configured. The workflow should request `permissions: id-token: write`, avoid npm tokens, verify the job is running from the expected release or tag event, verify the package version is unpublished, and only then run npm staged publishing with provenance using npm's current trusted-publishing command.
- Package-only publishing does not require full desktop app release validation unless the same change touches app behavior.
- Packages stay in the OpenWaggle monorepo for the first public releases. `@openwaggle/waggle-core` should remain extraction-friendly and may move to its own repository later only if real adoption or contributor pressure justifies the cross-repository release overhead.
- Each package should ship a concise hand-maintained package-local README for npm/GitHub consumers, while openwaggle.ai provides package documentation for install instructions, import paths, examples, API surface, and links between related packages. Package docs should live under `website/src/content/docs/packages/` with initial pages for overview, Extension SDK, Extension React, Waggle core, and Pi Waggle. User-facing package docs and package READMEs should not explain API snapshot tooling or internal release workflow; those remain internal validation and release artifacts.
- The OpenWaggle app consumes monorepo packages through `workspace:*`. Published package manifests must resolve workspace dependencies to caret semver ranges for the released dependency version, such as `^0.1.0`, during packing/publishing. Tarball smoke tests must prove those manifests work outside the workspace.

Responsibility split:

- OpenWaggle code changes own package metadata, package build scripts, pack/smoke validation, Release Please config, GitHub Actions workflows, and package author documentation.
- Maintainers own unblocking and owning the `@openwaggle` npm organization namespace, package name availability or placeholder creation, npm trusted publishing configuration, staged publish approvals, the GitHub `npm` environment or equivalent protection, first-publish approvals, and final license confirmation.

Do not publish development extension fixtures, installed QA copies, the website package, or root desktop app artifacts through the npm package workflow.

Packaged app QA for extension authoring must still prove that installed builds discover user-authored packages from both supported roots:

- project-local `<project>/.openwaggle/extensions/<extension-id>/`
- global app-data `extensions/<extension-id>/`

Development fixtures may be copied into those roots for QA, but they must not be shipped as production content or preinstalled extensions.
