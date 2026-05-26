# Agent Domain Context

OpenWaggle is one product domain: an Electron desktop coding-agent workspace built on Pi. Use this file as the Matt-skills domain map, then load the linked source docs for details.

## Canonical Sources

- `docs/first-principles.md` defines stable product and architecture principles.
- `docs/system-architecture.md` describes the current implementation shape.
- `docs/hexagonal-architecture.md` defines main-process layering rules.
- `docs/renderer-architecture.md` defines renderer organization, state, UI, testing, and enforcement rules.
- `docs/architecture.md` is the architecture documentation index.
- `docs/adr/` records why major architecture decisions were made.
- `MEMORY.md` records durable technical findings that are too specific for architecture docs.
- `.agents/standards.md` and `.agents/verification.md` define agent coding and validation rules.

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
- **Agent skills**: Reusable agent instructions under `.agents/skills/` or project-local `.openwaggle/skills/`.

## Skill Routing

- Use `diagnose` for bugs and regressions.
- Use `tdd` when implementation should start from a failing test.
- Use `improve-codebase-architecture` for deepening modules or architecture review.
- Use `to-prd` and `to-issues` for issue planning.
- Use `triage` for issue state movement.
- Use `zoom-out` when an agent needs a higher-level map before editing.
