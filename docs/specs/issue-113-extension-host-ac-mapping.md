# Issue 113 Extension Host AC Mapping

Status snapshot: 2026-06-12 on `codex/issue-113-openwaggle-extensions`.

This note maps the issue #113 unchecked acceptance criteria against the current codebase so docs work does not describe aspirational APIs as shipped behavior. The user-facing source of truth remains `website/src/content/docs/extending/openwaggle-extensions.md`; generated installed docs should continue to derive from that source.

## Implemented By Current Code

These unchecked issue items have current code support and can be documented as supported behavior:

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

## Partially Implemented Or Still Open

These items should remain documented as constrained or in-progress until final issue closure:

- Tests AC as issue state: targeted unit and component tests have passed in this integration pass, but final issue closure should still run the broad static/test/E2E/Electron QA matrix listed below.
- GitHub checkbox/admin state: the issue body should be updated only after final verification is green, because several unchecked boxes were already implemented before this mapping was written and the final three slices landed in this pass.
- Trusted renderer runtime: manifests and privilege review can represent `trusted.renderer`; mounted visual contributions still run through OpenWaggle's sandboxed extension frame boundary so renderer globals, writable stores, Electron IPC helpers, and other app internals are not exposed.

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

- Confirm Worker A adds public author-facing SDK and IPC methods for register/unregister, with preload/shared SDK wrappers and main-process handlers wired through application services.
- Confirm Worker A tests cover successful register/unregister round trips plus rejection for undeclared families, undeclared capabilities, broadened methods, replacing static manifest contributions, removing static manifest contributions, disabled/untrusted extensions, and stale lifecycle or project scope.
- Confirm Worker A verifies registry invalidation and renderer query refresh after runtime register/unregister so settings, side panels, agent-loop surfaces, routes, commands, and slash commands observe changes without app rebundling.
- Confirm Worker B keeps trusted-renderer execution behind an isolated boundary that prevents access to renderer globals, writable stores, Electron APIs, and Pi SDK internals.
- Confirm Worker B tests prove trusted-renderer frame mounting, teardown, lifecycle gating, and broker-only capability invocation.
- Confirm public docs describe the trusted-renderer path as isolated and brokered, not a direct host-renderer import.
- Confirm Worker C implements technical egress blocking for trusted main code, not only manifest validation or UI consent, and defines the exact allowed-origin matching rules for scheme, host, and port.
- Confirm Worker C tests direct Node-network calls from trusted main code with allowed and denied origins, including startup failure isolation and diagnostics when a denied call occurs.
- Confirm Worker C preserves frame CSP behavior for sandboxed visual contributions and does not weaken the existing brokered SDK or trusted-main activation boundary.
- Confirm final GitHub checkbox cleanup uses the issue body as an admin artifact only after code and tests prove the ACs, because several unchecked boxes are already implemented by current code while the three remaining slices still need implementation evidence.

## Final Verification Commands

Run targeted checks for the three remaining slices first:

```bash
pnpm test:unit:raw -- src/shared/schemas/__tests__/extension-contribution-registration.unit.test.ts src/main/application/__tests__/extension-runtime-contribution-authorization.unit.test.ts src/main/application/__tests__/extension-runtime-contribution-unregistration.unit.test.ts src/main/application/__tests__/extension-contribution-registry-service.unit.test.ts src/main/ipc/__tests__/extensions-handler-contributions.unit.test.ts src/preload/__tests__/extension-sdk.unit.test.ts
pnpm test:unit:raw -- src/main/extensions/__tests__/trusted-main-runtime.unit.test.ts src/main/application/__tests__/extension-trusted-main-activation-service.unit.test.ts src/main/application/__tests__/extension-trusted-main-startup-isolation.unit.test.ts src/main/application/__tests__/extension-lifecycle-safe-start-service.unit.test.ts src/main/application/__tests__/extension-capability-broker-package-mutation-guard.unit.test.ts
pnpm test:component -- src/renderer/src/features/extensions/components/__tests__/ExtensionFederatedModuleHost.component.test.tsx src/renderer/src/features/settings/components/__tests__/ExtensionPackageCard.requirements.component.test.tsx src/renderer/src/features/settings/components/__tests__/SettingsContributionHost.component.test.tsx
```

Run integration/e2e proof for extension lifecycle and runtime rendering:

```bash
pnpm test:integration
pnpm test:e2e:headless:quick e2e/extension-host.e2e.test.ts
```

Run final static and broad checks before closing the issue:

```bash
pnpm check
pnpm test
pnpm test:e2e:headless e2e/extension-host.e2e.test.ts
```

For renderer, preload, IPC, or interaction changes, also run real Electron QA:

```bash
pnpm dev:debug
```

Then verify Settings > Extensions, `window.api`, contribution mounting, dynamic register/unregister behavior, trusted-renderer behavior if implemented, trusted-main network allow/deny behavior, and console errors through the Electron QA CDP path.
