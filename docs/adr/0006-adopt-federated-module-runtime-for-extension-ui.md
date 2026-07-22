# Adopt Federated Module Runtime For Extension UI

Status: accepted

OpenWaggle visual desktop contributions will be modeled as a contribution surface, a contribution runtime, and an execution placement. The default visual runtime is a framework-neutral federated module that exports `mount(context)`, so extension authors can build with React, Vue, Preact, Svelte, plain DOM, or other UI stacks while OpenWaggle owns the contribution container and passes a typed SDK/theme/surface context.

The federated-module runtime is the author contract, not a React-only lane. Its implementation may use module federation, versioned runtime URLs, import maps, or another runtime-loading mechanism, but extension code exports the same `mount(context)` entry point and does not import OpenWaggle renderer internals.

## Considered Options

- Declarative host-rendered UI for every surface would maximize native consistency, but it would constrain extension authors and force OpenWaggle to design a large component schema before the platform proves itself.
- React-only trusted modules would integrate tightly with the OpenWaggle renderer, but it would make React the extension platform instead of one possible implementation choice.
- Sandboxed iframe or webview apps would preserve isolation, but they would not provide a single default model for host-rendered surfaces, shared extension state, or optional shared OpenWaggle modules.

## Consequences

- Extension manifests should evolve from lane-centric language toward `surface`, `runtime`, and `execution` concepts.
- Visual surfaces include settings sections, side panels, dialogs, routes, transcript cards, status widgets, and compact composer action surfaces. The composer surface is for actions and launchers, not arbitrary composer input injection.
- A visual contribution module must mount into an OpenWaggle-owned container through a typed mount context instead of importing renderer internals.
- Host-renderer and frame execution placements use the same `mount(context)` contract; placement changes how OpenWaggle provides the context, not what the extension exports.
- Existing placeholder route/content experiments should be replaced by the federated-module model instead of maintained as a parallel legacy visual runtime.
- OpenWaggle may provide optional shared modules such as SDK, theme, or UI helpers, but the required contract is the mount context.
- Agent-loop contributions use the same federated-module mount contract for desktop rendering, but bind to Pi-native tool names or custom message types instead of inventing OpenWaggle-only runtime event names.
- Multiple agent-loop contributions may bind to the same Pi-native tool name or custom message type across different OpenWaggle-owned surfaces; transcript rendering remains the durable fallback record while dialogs, side panels, status widgets, and composer actions provide auxiliary live surfaces.
- Interactive agent-loop contributions should support Pi's common interaction primitives first (`confirm`, `select`, `input`, `editor`, `notify`) and then typed custom interactions for cases that do not fit those primitives.
- OpenWaggle should not execute Pi TUI components inside Electron for `custom()` interactions; it should preserve the typed request/response semantics and render custom desktop interactions with federated modules or a safe unsupported fallback.
- Default desktop placement should be primitive-based rather than universal: blocking interactions are prominent, informational interactions avoid stealing focus, and the transcript remains the durable audit trail for pending and resolved agent-loop requests.
- The public extension docs must expose the request and response schemas for each desktop interaction primitive so extension authors and agents can discover what OpenWaggle supports without reading renderer internals.
- The agent-loop implementation should land as an end-to-end vertical slice that includes Pi interaction bridging, OpenWaggle fallback UI, transcript pending/resolved records, public schemas/docs, and extension-provided federated renderers for tool cards or custom interactions.
- Agent-facing installed docs should be generated from the full user-facing OpenWaggle docs into a Pi-style package-local docs directory at build or packaging time, alongside installed Pi docs, not maintained as a second repository source of truth.
- The generated docs bundle should include a root README and topic index that route extension authors and agents to manifest, SDK, agent-loop, interaction, Pi runtime, settings, and QA fixture documentation without requiring path guessing.
- Extension SDK and agent capabilities should resolve installed documentation through typed topic names and metadata rather than requiring extensions or agents to know source, dev, or packaged path layouts.
- The same docs topic map should serve extension code and OpenWaggle's self-modifying agent context so both discover the same public contracts.
- First-party docs topics should be closed and typed; extension-provided package-local docs use a structured extension namespace with provenance metadata instead of weakening the first-party topic contract.
- Extensions may share reactive in-memory package state across multiple contributions and keep contribution instance state for one mounted contribution; persistent data is written explicitly through typed storage capabilities.
- Agent-loop contribution modules may use package or instance state for live coordination, but historical transcript rendering must be reconstructable from the mount context and Pi session data rather than from a still-mounted renderer.
- Agent-loop mount contexts should pass OpenWaggle public DTOs, not Pi package types, while retaining Pi-native identifiers such as tool name, custom message type, tool call id, interaction id, and partial/final result state.
- Extensions can read selected OpenWaggle state through fully typed SDK read capabilities and request mutations through typed action capabilities; they must not import writable OpenWaggle stores directly.
- The first federated-module use case should be a development-only GitHub Issues Overview fixture mounted across settings, side panel, and agent-loop surfaces while sharing package state, because it proves multiple surfaces, one mount contract, realistic configuration, OpenWaggle-owned containers, extension-owned content, Pi-native tool registration, interaction fallback, and custom desktop rendering in one vertical slice.
- The GitHub Issues Overview fixture should include a Pi-native tool such as `openwaggle.github.listIssues`, standard Pi interactions such as `confirm`, and at least one custom desktop interaction or transcript tool renderer, with QA proving both the custom renderer path and the generic fallback path.
- Development and demo extensions belong under `fixtures/extensions/`, are installed manually for local QA, and must be excluded from packaged app output.
