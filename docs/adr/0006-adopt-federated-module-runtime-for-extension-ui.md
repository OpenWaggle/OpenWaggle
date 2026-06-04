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
- Extensions may share reactive in-memory package state across multiple contributions and keep contribution instance state for one mounted contribution; persistent data is written explicitly through typed storage capabilities.
- Extensions can read selected OpenWaggle state through fully typed SDK read capabilities and request mutations through typed action capabilities; they must not import writable OpenWaggle stores directly.
- The first federated-module use case should be a development-only GitHub Issues Overview fixture mounted across settings and side panel surfaces with host-renderer execution while sharing package state, because it proves multiple surfaces, one mount contract, realistic configuration, OpenWaggle-owned containers, and extension-owned content in one vertical slice.
- Development and demo extensions belong under `fixtures/extensions/`, are installed manually for local QA, and must be excluded from packaged app output.
