# Agent Domain Context

OpenWaggle is one product domain: an Electron desktop coding-agent workspace built on Pi. Use this file as the Matt-skills domain map, then load the linked source docs for details.

## Canonical Sources

- `CONTEXT.md` defines canonical OpenWaggle product-domain language.
- `docs/first-principles.md` defines stable product and architecture principles.
- `docs/system-architecture.md` describes the current implementation shape.
- `docs/hexagonal-architecture.md` defines main-process layering rules.
- `docs/renderer-architecture.md` defines renderer organization, state, UI, testing, and enforcement rules.
- `docs/architecture.md` is the architecture documentation index.
- `docs/adr/` records why major architecture decisions were made.
- `MEMORY.md` records durable technical findings that are too specific for architecture docs.
- `.agents/standards.md` and `.agents/verification.md` define agent coding and validation rules.
- `website/src/content/docs/extending/openwaggle-extensions.md` is the user-facing extension author contract.

## Domain Map

### Pi Runtime Kernel

Pi owns runtime execution, session continuity, native tool events, provider/model/auth metadata, MCP extension execution, thinking levels, and compaction behavior. OpenWaggle owns UI, product projection, persistence read models, and adapter boundaries.

Load `.agents/skills/pi-integration/SKILL.md` before changing Pi adapters, provider/auth/model flows, session projection, MCP/resource loading, compaction, or run orchestration.

### Session Projection

OpenWaggle projects Pi sessions into SQLite-backed session, node, branch, branch-state, and tree UI state tables. Session Tree, branch lifecycle, transcript rendering, active-run continuity, and Waggle mode must operate over the same projection instead of creating parallel state.

Primary references:

- `docs/system-architecture.md`
- `docs/renderer-architecture.md`
- `docs/specs/pi-migration-remaining-work.md`
- `MEMORY.md`

### Renderer And Product Shell

The renderer is React 19 with React Compiler, TanStack Router/Query, Zustand, and Tailwind v4. It consumes typed IPC DTOs and `AgentTransportEvent` streams; it must not consume Pi SDK objects.

Renderer work should preserve visible user control: truthful tool rendering, explicit session/branch state, branch-scoped composer config, clear stop/cancel behavior, and local-first settings.

### Providers And Models

Provider, model, auth, OAuth, and thinking-level metadata come from Pi through OpenWaggle-owned ports. Do not add a parallel OpenWaggle provider registry.

### MCP And Project Resources

Pi resource loading is the runtime source of truth. OpenWaggle injects project roots in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes, then strips implicit roots when Pi persists settings.

MCP config precedence is documented in `docs/configuration.md`.

### OpenWaggle Extensions

OpenWaggle extension packages add desktop contributions and optional Pi runtime resources. Load `website/src/content/docs/extending/openwaggle-extensions.md` before changing extension discovery, lifecycle, SDK schemas, federated module rendering, agent-loop contributions, interaction bridging, package create/update/remove workflows, or extension QA fixtures. User-facing website docs are the source of truth. The existing `pnpm docs:generate` path derives `build/openwaggle-docs` from `website/src/content/docs/**` plus installed Pi docs for agent-facing installed documentation, instead of maintaining a second repository copy. Generated installed docs need a root index and topic aliases so agents can find docs without guessing paths. Runtime docs lookup should go through a typed docs discovery capability available to both extension code and OpenWaggle's self-modifying agent context. Extension package writes are OpenWaggle-owned workflows: extension code must not modify extension packages directly; agents can create, update, or remove packages only after user approval of the exact proposal, and global package changes require stronger global-impact confirmation.

### Waggle Mode

Waggle is collaborative multi-agent behavior over the same Pi-backed session projection as standard mode. The target package split is portable `@openwaggle/waggle-core` plus Pi adapter `@openwaggle/pi-waggle` (ADR-0004). Agent attribution belongs in message metadata and transport metadata projected from Pi session truth, not synthetic transcript tool calls.

Primary references:

- `docs/specs/pi-waggle-extension-package-spec.md`
- `docs/specs/waggle-composer-wireframes.md`
- `website/src/content/docs/using-openwaggle/waggle-mode.md`

### Release And Distribution

OpenWaggle currently ships prerelease alpha artifacts through GitHub release automation. Platform signing/notarization remains a distribution trust gap.

Load `.agents/skills/release/SKILL.md` for versioning, release workflow, update-track, or installer work.

## Glossary

- **Pi**: Runtime kernel and source of truth for agent execution, native tools, sessions, providers, models, auth, MCP extensions, and compaction.
- **OpenWaggle projection**: SQLite read model and UI state over Pi sessions, nodes, branches, and product metadata.
- **Session Tree**: Product navigation over projected Pi session nodes and branches.
- **Branch-scoped config**: Composer and mode configuration attached to a branch, inherited by child branches unless overridden.
- **Waggle**: Multi-agent collaboration mode running through Pi-native extension/runtime behavior.
- **Inherited Waggle model**: A Waggle agent model choice that follows the current standard-mode selected model unless the agent is explicitly pinned to a provider/model.
- **Waggle preset suppression**: User or project configuration that hides a package-provided preset from resolved Waggle preset lists without modifying the installed package.
- **Project resource roots**: `.openwaggle`, `.pi`, and `.agents` resource folders injected into Pi with OpenWaggle precedence.
- **OpenWaggle extension package**: A first-class OpenWaggle package, usually under `.openwaggle/extensions/<id>/` for project-local development, that can contribute desktop UI/behavior and optionally include Pi runtime resources.
- **Approved extension package workflow**: The OpenWaggle-owned create, update, or remove path where an agent proposes exact package changes, the user approves the proposal hash, and OpenWaggle performs filesystem and lifecycle mutations.
- **Global extension package confirmation**: The additional confirmation required before an agent-created workflow modifies an app-data global extension package that can affect every project.
- **Extension uninstall teardown**: Remove workflow behavior that unregisters contributions, denies sandboxed module/runtime access, deletes lifecycle trust and enablement pins, and removes the package directory.
- **Development extension fixture**: An extension package used only for local QA, tests, or demos and never shipped as product content.
- **OpenWaggle desktop contribution**: A declared extension contribution to an OpenWaggle-owned product surface.
- **Extension contribution surface**: The OpenWaggle-owned place where an extension contribution appears, such as a route, side panel, dialog, settings section, transcript card, status widget, or compact composer action.
- **Extension contribution container**: The OpenWaggle-owned shell around mounted extension content, including placement, chrome, sizing, docking, and persistence rules.
- **Extension contribution runtime**: The execution model OpenWaggle uses to load and mount a visual extension contribution.
- **Extension execution placement**: The runtime location where a visual extension contribution runs, such as the OpenWaggle renderer or an isolated frame.
- **Federated module runtime**: The default framework-neutral visual contribution runtime where OpenWaggle loads an extension module and passes a typed mount context.
- **Extension mount context**: The typed object passed to a federated module so it can attach UI to a host-provided root and use the public extension SDK.
- **Composer extension surface**: A compact composer-adjacent action surface for extension buttons, selectors, or launchers, not arbitrary composer input injection.
- **Extension capability broker**: The main-process authorization boundary for extension calls. Extensions use brokered capability APIs instead of direct Electron IPC, renderer internals, stores, or Pi SDK objects.
- **Extension SDK surface**: The intentional public API exposed to extensions for contribution behavior, capability calls, theme/context data, and scoped state.
- **OpenWaggle shared extension module**: An optional host-provided module an extension can import for SDK, theme, or UI convenience when using the federated-module runtime.
- **OpenWaggle state read capability**: A fully typed public SDK capability that lets extension code read or subscribe to selected OpenWaggle state without importing internal stores.
- **OpenWaggle action capability**: A fully typed public SDK capability that lets extension code request an OpenWaggle behavior change without writing internal stores.
- **Extension package state**: Extension-owned reactive in-memory state shared across all contributions from the same OpenWaggle extension package.
- **Extension contribution instance state**: Extension-owned state scoped to one mounted contribution instance.
- **Agent-loop contribution**: A desktop contribution that renders or collects feedback during an active Pi agent loop.
- **Agent-loop binding identity**: The Pi-native tool name or custom message type rendered by an agent-loop contribution.
- **Extension interaction schema**: The public typed request-and-response contract for rendering Pi interaction primitives in OpenWaggle.
- **Agent-loop event DTO**: An OpenWaggle public data shape that preserves Pi agent-loop semantics for extension renderers without exposing Pi package internals.
- **Agent-facing installed documentation**: Build-produced package-local docs derived from the full OpenWaggle docs and installed Pi docs so self-modifying agents can inspect an installed app.
- **Installed docs index**: Generated entry point that maps common agent questions to package-local OpenWaggle and Pi documentation paths.
- **Docs discovery capability**: Typed OpenWaggle capability that resolves installed and discovered documentation topics to local documentation paths and lightweight provenance metadata.
- **Docs discovery topic**: First-party typed topic that identifies an OpenWaggle or Pi documentation entry.
- **Extension package documentation**: Package-local documentation shipped by an OpenWaggle extension package in a Pi-style `docs/` directory.
- **Self-modifying agent context**: OpenWaggle-provided context that lets an agent inspect and change OpenWaggle itself using installed product documentation and runtime contracts.
- **Pi extension parity for OpenWaggle**: OpenWaggle extensions should preserve Pi-level runtime/resource modification power and extend equivalent contribution capability to OpenWaggle-owned desktop surfaces.
- **Trusted local extension code**: Extension code the user explicitly approves to run locally. Trust is keyed to package identity, SDK compatibility, version, and content hash, and does not permit importing OpenWaggle internals.
- **Extension safe startup**: OpenWaggle must start even when extension activation fails. Extension failures are isolated to contributions first, then to the extension, and recovery controls remain OpenWaggle-owned.
- **Agent skills**: Reusable agent instructions under `.agents/skills/` or project-local `.openwaggle/skills/`.

## Skill Routing

- Use `diagnose` for bugs and regressions.
- Use `tdd` when implementation should start from a failing test.
- Use `improve-codebase-architecture` for deepening modules or architecture review.
- Use `to-prd` and `to-issues` for issue planning.
- Use `triage` for issue state movement.
- Use `zoom-out` when an agent needs a higher-level map before editing.
