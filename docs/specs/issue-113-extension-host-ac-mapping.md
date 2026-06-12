# Issue 113 Extension Host AC Mapping

Status snapshot: 2026-06-11 on `codex/issue-113-openwaggle-extensions`.

This note maps the issue #113 unchecked acceptance criteria against the current codebase so docs work does not describe aspirational APIs as shipped behavior. The user-facing source of truth remains `website/src/content/docs/extending/openwaggle-extensions.md`; generated installed docs should continue to derive from that source.

## Implemented By Current Code

These unchecked issue items have current code support and can be documented as supported behavior:

- Safe startup and failure isolation: discovery, manager view, contribution registry, Pi runtime extension loading, trusted-main startup, and renderer slot boundaries isolate extension failures instead of blocking app startup.
- Add or augment surfaces only: controlled extension routes, settings sections, side panels, dialogs, transcript/tool/custom-message/interaction renderers, status widgets, and compact composer actions are host-owned containers; extensions do not replace shell navigation or app themes.
- Optional SDK/theme/UI helpers: `src/shared/extension-sdk.ts`, `src/shared/extension-theme.ts`, and `src/shared/extension-ui.ts` provide framework-neutral helpers; the required runtime contract remains `mount(context)`.
- OpenWaggle state/action/settings capabilities: brokered `openwaggle.state`, `openwaggle.actions`, and `openwaggle.settings` paths provide typed reads/actions/settings updates without exposing writable renderer stores.
- Trusted local main code: `trusted.main` entries are hash-pinned, activated only after lifecycle trust/enable/reload, and receive the public broker SDK context rather than OpenWaggle internals.
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

These items should remain documented as constrained or in-progress until their implementation is completed by the owning workers:

- Dynamic runtime contribution registration: schemas and authorization guards exist, and they enforce manifest-declared families plus no new capabilities/methods. A public SDK/IPC path that lets runtime code register/unregister contributions is not wired, so the current public author path is static manifest contributions.
- Trusted renderer runtime: manifests can declare `trusted.renderer` and Settings treats it as a privileged requirement, but current visual contribution loading uses the federated-module frame/container path. Do not document direct trusted renderer internals as available.
- Network enforcement for trusted local code: manifests declare `network.origins`, Settings requires consent, and frame CSP restricts sandboxed UI `connect-src` to declared origins. Trusted main code is trusted local Node code; there is no egress firewall that technically prevents undeclared direct network calls.
- Tests AC as issue state: broad tests are present, but this docs slice did not run the full extension E2E or full static suite. Treat green status as pending verification for final issue closure.

## Documentation Changes Needed

- Update `website/src/content/docs/extending/openwaggle-extensions.md` so create, build, install, trust, update, disable, remove, and app-update boundaries are easy to scan from one page.
- Clarify that static manifest contributions are the current public path; dynamic registration is guarded internally but not yet exposed as an author-facing API.
- Clarify that `trusted.renderer` is privileged metadata/consent today, while current visual contributions still mount through the federated-module container path.
- Clarify network behavior: frame UI is CSP-restricted to declared origins; trusted main is trusted local code and should declare origins for user review rather than relying on host egress enforcement.
- Update `website/src/content/docs/extending/plugins.md` so it points readers to the current local extension host instead of describing it only as planned.
- Keep installed docs generated from `website/src/content/docs/**`; do not hand-edit generated `build/openwaggle-docs` output.
