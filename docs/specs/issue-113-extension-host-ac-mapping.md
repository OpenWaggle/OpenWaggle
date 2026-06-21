# Issue 113 Extension Host AC Mapping

Status snapshot: 2026-06-20 on `codex/issue-113-openwaggle-extensions` after commit `1b12f265`.

This note maps issue #113 acceptance criteria against the current codebase so docs work does not describe aspirational APIs as shipped behavior. The user-facing source of truth remains `website/src/content/docs/extending/openwaggle-extensions.md`; generated installed docs should continue to derive from that source.

GitHub issue #113 currently has 59 checked acceptance criteria from the extension-host runtime work, but package publishing is now part of the same issue scope. The issue should not be closed until the package publishing scope is represented in the issue body and implemented or explicitly split later by maintainer decision.

## Implemented By Current Code

These issue items have current code support and can be documented as supported behavior:

- Safe startup and failure isolation: discovery, manager view, contribution registry, Pi runtime extension loading, trusted-main startup, and renderer slot boundaries isolate extension failures instead of blocking app startup.
- Add or augment surfaces only: controlled extension routes, settings sections, side panels, dialogs, transcript/tool/custom-message/interaction renderers, status widgets, and compact composer actions are host-owned containers; extensions do not replace shell navigation or app themes.
- Optional SDK/theme/UI helpers: `src/shared/extension-sdk.ts`, `src/shared/extension-theme.ts`, and `src/shared/extension-ui.ts` provide framework-neutral helpers; the required runtime contract remains `mount(context)`.
- OpenWaggle state/action/settings capabilities: brokered `openwaggle.state`, `openwaggle.actions`, and `openwaggle.settings` paths provide typed reads/actions/settings updates without exposing writable renderer stores.
- Dynamic runtime contribution registration: `openwaggle.runtime` exposes typed `register-contribution` and `unregister-contribution` broker methods through the public SDK. Runtime registrations are layered over static manifest contributions, constrained to the invocation scope, and cannot add undeclared families, capabilities, methods, or replace/remove static manifest contributions.
- Trusted local main code: `trusted.main` entries are hash-pinned, activated only after lifecycle trust/enable/reload, and receive the public broker SDK context rather than OpenWaggle internals.
- Network enforcement for trusted local code: trusted main activation and cleanup run inside a technical network policy that guards direct `fetch`, `node:http`, `node:https`, `electron.net`, raw `node:net`, raw `node:tls`, UDP sockets, direct DNS resolution, `node:http2`, child processes, cluster forks, and worker threads. Only exact manifest-declared HTTPS origins are allowed; unresolved targets, redirects, custom fetch agents/dispatchers, custom Node HTTP agents/connection factories/DNS lookup functions, Unix socket paths, raw sockets, and process/isolate escape hatches fail closed.
- Privilege consent and runtime requirements: Settings surfaces capability, network, local-build, trusted-main, trusted-renderer, and runtime binary/command requirements before trust; enabling fails closed when required grants are missing.
- Pi runtime/resource parity: enabled OpenWaggle extension packages and manifest-declared `pi.resourceRoots` are passed into Pi runtime service creation, preserving Pi package/resource semantics.
- Extension package mutation guard: extension code cannot use broker capabilities to mutate extension packages; create/update/remove use the user-approved package workflow, with stronger confirmation for global scope.
- Agent-created project/global package workflow: proposal hashes cover operation, scope, paths, and file contents; global writes require `global-extension-package-write` confirmation.
- Disable/remove teardown: disabling clears reload state, contribution registry eligibility, runtime module access, and trusted-main activation; approved removal unregisters, deletes lifecycle pins, and removes the package directory.
- Multi-surface agent-loop rendering: the same Pi-native event can be rendered across transcript, interaction panel, dialogs, side panels, and status widgets, with transcript/fallback UI as the durable path.
- Typed custom desktop interactions: custom interactions resolve by interaction kind, do not run Pi TUI components inside Electron, and show an explicit reject fallback when no matching renderer is available.
- Boundary shape: implementation uses shared schemas/DTOs, main-process application services/ports/adapters, renderer extension containers, and brokered IPC instead of direct extension access to renderer stores, Pi SDK internals, or Electron internals as a supported path.
- Test coverage exists across manifest schemas, lifecycle, SDK compatibility, hash/update behavior, broker authorization/rejection, IPC handlers, contribution registry, renderer host mounting, federated module loading, trusted-main activation, safe startup, and the E2E extension-host flow.

## Issue Closure State

The extension-host runtime acceptance criteria passed final validation, but the current issue now includes package publishing for the public OpenWaggle package set.

- Tests AC as issue state: broad static, test, build, website, React Doctor, targeted extension-host E2E, and full headless E2E validation passed on the committed tree.
- GitHub checkbox/admin state: issue #113 was updated after green validation for the extension-host runtime scope. It now needs an added package-publishing section before closure.
- Trusted renderer runtime: manifests and privilege review can represent `trusted.renderer`; mounted visual contributions run through OpenWaggle's sandboxed extension frame boundary so renderer globals, writable stores, Electron IPC helpers, and other app internals are not exposed.

## Package Publishing Scope Added To Current Issue

The package publishing work belongs to issue #113, not a follow-up issue. The current agreed publishable package set is:

- `@openwaggle/extension-sdk`
- `@openwaggle/extension-react`
- `@openwaggle/waggle-core`
- `@openwaggle/pi-waggle`

The current agreed direction:

- Packages use independent semver versions and a shared Release Please package workflow.
- Initial public package versions are `0.1.0`.
- All public package source lives under `packages/*`: `packages/extension-sdk`, `packages/extension-react`, `packages/waggle-core`, and `packages/pi-waggle`.
- Existing `packages/waggle-core` and `packages/pi-waggle` must be converted from private raw-TS workspace packages into real publishable packages instead of duplicated elsewhere.
- `@openwaggle/waggle-core` is runtime-neutral and must not import Pi SDK packages, Electron, Node built-ins, renderer stores, or app services.
- `@openwaggle/pi-waggle` depends on `@openwaggle/waggle-core` and receives a dependent package bump whenever Waggle core changes.
- `@openwaggle/pi-waggle` replaces wildcard Pi peer dependencies with explicit initial peer ranges: `@earendil-works/pi-coding-agent: ^0.78.1` and `@earendil-works/pi-tui: ^0.78.1`.
- `@openwaggle/extension-react` depends on `@openwaggle/extension-sdk` and receives a dependent package bump whenever the extension SDK changes.
- `@openwaggle/extension-react` declares `react` and `react-dom` as `^19.0.0` peer dependencies, uses package-local React/React DOM dev dependencies for build/tests, and must not bundle React.
- Packed and published package manifests rewrite local `workspace:*` OpenWaggle dependencies to caret semver ranges such as `^0.1.0`.
- Packages ship dual ESM/CommonJS output plus TypeScript declarations from plain TypeScript builds, not a bundler, unless a package has a documented reason to diverge.
- Public imports are limited to explicit package export maps; deep imports into source or build output are unsupported.
- Initial explicit export maps are: `@openwaggle/extension-sdk`, `@openwaggle/extension-sdk/manifest`, `@openwaggle/extension-sdk/broker`, `@openwaggle/extension-sdk/runtime`, `@openwaggle/extension-sdk/theme`, `@openwaggle/extension-sdk/ui`, `@openwaggle/extension-sdk/agent-loop`, `@openwaggle/extension-sdk/docs`, `@openwaggle/extension-react`, `@openwaggle/extension-react/styles.css`, `@openwaggle/waggle-core`, `@openwaggle/waggle-core/config`, `@openwaggle/waggle-core/consensus`, `@openwaggle/waggle-core/events`, `@openwaggle/waggle-core/presets`, `@openwaggle/waggle-core/prompts`, `@openwaggle/waggle-core/state`, `@openwaggle/waggle-core/turn-policy`, `@openwaggle/pi-waggle`, `@openwaggle/pi-waggle/commands`, `@openwaggle/pi-waggle/extension`, `@openwaggle/pi-waggle/loop`, `@openwaggle/pi-waggle/mode-state`, `@openwaggle/pi-waggle/preset-storage`, `@openwaggle/pi-waggle/presets`, `@openwaggle/pi-waggle/protocol`, `@openwaggle/pi-waggle/renderers`, and `@openwaggle/pi-waggle/stop-policy`.
- Package manifests declare explicit `sideEffects` metadata: `false` for code-only packages and `["./styles.css"]` for `@openwaggle/extension-react`.
- Package manifests declare `publishConfig.access: "public"`.
- Package tarballs include built output and package docs only: no `src/**`, tests, fixtures, tsconfigs, local scripts, `.openwaggle/**`, build caches, or generated source maps unless a later package decision explicitly enables them.
- Package validation includes committed API surface snapshots for every publishable package so unintended public declaration changes fail validation. Prefer API Extractor-style declaration reports if practical; otherwise use a deterministic repo-owned declaration snapshot script.
- `@openwaggle/extension-sdk` owns the canonical author-facing extension SDK source and stays React-free.
- `@openwaggle/extension-sdk` is browser-safe and must not import Electron, Node built-ins, main-process services, renderer stores, or Pi SDK packages.
- `pnpm check:repository-standards` must enforce publishable package import boundaries for extension-sdk, waggle-core, extension-react, and pi-waggle.
- `@openwaggle/extension-sdk` exports both direct public Effect Schema boundary values and helper APIs such as manifest definition and validation helpers; Effect Schema is the primary runtime schema contract for `0.1.0`, with JSON Schema left as a possible secondary artifact later.
- `@openwaggle/extension-react` owns React 19 component primitives for extension authors and depends on `@openwaggle/extension-sdk`.
- Each publishable package ships a concise hand-maintained README, and comprehensive package guidance lives on openwaggle.ai package docs.
- Package docs live under `website/src/content/docs/packages/` with overview, Extension SDK, Extension React, Waggle core, and Pi Waggle pages; extension authoring guides link to those pages for install/API usage details.
- User-facing package docs and package READMEs do not explain API snapshot tooling; snapshots remain internal validation artifacts.
- Package publishing follows the Release Please model used by `ts-match`, with package-local changelogs, package-specific tags, API snapshots, tarball validation, smoke installs, npm trusted publishing/provenance, and npm staged publish approval before packages become public.
- Package release tags use short package-name tags such as `extension-sdk-v0.1.0`, `extension-react-v0.1.0`, `waggle-core-v0.1.0`, and `pi-waggle-v0.1.0`, not scoped npm names.
- Each package release gets its own GitHub Release, even when multiple packages are released from the same Release Please PR.
- Real package staging/publishing runs only from Release Please-created release or tag events; manual workflow dispatch is dry-run validation only.
- Local maintainer `npm publish` is not an allowed fallback; failed publishes should be fixed and rerun through trusted GitHub Actions.
- Publish validation includes an early provenance/OIDC gate before staging: expected GitHub event, `id-token: write`, trusted-publishing identity, no npm token fallback, and unpublished package version.
- The OpenWaggle desktop app release workflow remains separate from npm package publishing.
- First public package publishing is blocked until the maintainer owns and configures the `@openwaggle` npm organization namespace; the packages should not be temporarily published under a personal scope.
- Packaged-app QA must prove project-local `.openwaggle/extensions/<extension-id>/` and global app-data `extensions/<extension-id>/` roots remain discoverable for user-authored and agent-authored packages, while development fixtures are not shipped as production content.

The issue should add explicit package-publishing AC after the grilling session finishes so the final AC reflect the actual implementation plan.

## Package Publishing Implementation Slices

Package publishing should be implemented as parallel-safe slices with one sequencing rule: package source and manifest shape come first.

1. Package extraction/build: create `packages/extension-sdk` and `packages/extension-react`; convert `packages/waggle-core` and `packages/pi-waggle` from private raw-TS workspace packages into built publishable packages.
2. Validation: export smoke tests, tarball checks, API snapshots, import-boundary checks, and package-manager smoke installs.
3. Release workflow: Release Please config, GitHub Actions, trusted publishing and staged-publish dry-run path, package tag conventions, and package GitHub Release behavior.
4. Docs: package READMEs, website package docs, and issue #113 AC update.

Slice 1 should start first because it defines package manifests and export maps. Slices 2 and 3 can begin once slice 1 defines the package manifests/exports. Slice 4 can start from the documented decisions, but examples must be checked against the final slice 1 exports before merge.

## Recently Integrated Slice Evidence

- Dynamic runtime registration: implemented in `src/main/application/extension-capability-broker-runtime.ts`, `src/shared/extension-sdk-runtime.ts`, the broker schemas/types, and `src/main/application/extension-contribution-registry-cache.ts`.
- Trusted renderer runtime: `src/renderer/src/features/extensions/components/ExtensionContributionRuntimeHost.tsx` routes `trusted-renderer` entries through the isolated extension frame host instead of importing them into the app renderer global.
- Trusted main network enforcement: implemented by `src/main/extensions/trusted-main-network-egress.ts`, `src/main/extensions/trusted-main-network-http-guard.ts`, and `src/main/extensions/trusted-main-network-socket-guard.ts`.

## Documentation Status

- `website/src/content/docs/extending/openwaggle-extensions.md` already explains create, build, install, trust, update, disable, remove, and app-update boundaries from one page.
- The public docs now describe both static manifest contributions and dynamic `context.sdk.runtime.registerContribution(...)` / `unregisterContribution(...)`.
- The public docs now describe `trusted.renderer` as privileged metadata and state that `trusted-renderer` entries are frame-mounted through the same brokered SDK/context boundary as federated visual contributions.
- The public docs now describe frame CSP restrictions and trusted-main network egress enforcement.
- `website/src/content/docs/extending/plugins.md` already points readers to local OpenWaggle extension packages instead of describing desktop extensions only as planned.
- Keep installed docs generated from `website/src/content/docs/**`; do not hand-edit generated `build/openwaggle-docs` output.

## Integration Reviewer Checklist

Reviewer confirmation points for PR review:

- Runtime contribution registration has public author-facing SDK and IPC methods for register/unregister, with preload/shared SDK wrappers and main-process handlers wired through application services.
- Runtime contribution tests cover successful register/unregister round trips plus rejection for undeclared families, undeclared capabilities, broadened methods, replacing static manifest contributions, removing static manifest contributions, disabled/untrusted extensions, stale lifecycle, and out-of-scope project/session/branch calls.
- Registry invalidation and renderer query refresh after runtime register/unregister let settings, side panels, agent-loop surfaces, routes, commands, and slash commands observe changes without app rebundling.
- Trusted-renderer execution stays behind an isolated boundary that prevents access to renderer globals, writable stores, Electron APIs, and Pi SDK internals.
- Trusted-renderer tests prove frame mounting, teardown, lifecycle gating, and broker-only capability invocation.
- Public docs describe the trusted-renderer path as isolated and brokered, not a direct host-renderer import.
- Trusted-main code has technical egress blocking, not only manifest validation or UI consent, with exact allowed-origin matching for scheme, host, and port.
- Trusted-main tests cover direct Node-network calls with allowed and denied origins, including startup failure isolation and diagnostics when a denied call occurs.
- Frame CSP behavior for sandboxed visual contributions remains in place and the brokered SDK or trusted-main activation boundary is not weakened.
- GitHub checkbox cleanup was performed only after code and tests proved the ACs.

## Final Verification Evidence

Final validation passed on the committed tree:

```bash
pnpm check
pnpm test
pnpm build
pnpm website:build
npx -y react-doctor@latest . --verbose --diff main
pnpm test:e2e:headless:quick e2e/extension-host.e2e.test.ts
pnpm test:e2e:headless
```

React Doctor was run with an isolated npm cache because the shared npm cache had root-owned entries. It reported 100/100 with no issues.

For manual real-Electron QA before merge:

```bash
pnpm dev:debug
```

Then verify Settings > Extensions, `window.api`, contribution mounting, dynamic register/unregister behavior, trusted-renderer behavior, trusted-main network allow/deny behavior, and console errors through the Electron QA CDP path.
