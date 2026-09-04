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

Pi owns runtime execution, session continuity, native tool events, provider/model/auth metadata, thinking levels, and compaction behavior. OpenWaggle owns the first-party MCP runtime, UI, product projection, persistence read models, and adapter boundaries.

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

Syntax-rendered content is the renderer category for text with an explicit or reliably derived language grammar: workspace documents, fenced code, diffs, project-search snippets, and structured payloads such as JSON, YAML, XML, or TOML when their type is known. Raw logs, errors, and terminal output remain plain or ANSI unless their producer supplies explicit language metadata. This boundary follows content semantics, not monospace styling or `<pre>` markup.

Workspace source review and focused editing are first-party product capabilities, with external-editor handoff for IDE work. Pierre owns diffs, virtualized source views, and focused single-file editing, and shares language and Syntax theme contracts with the other syntax adapters.

Editable files cross process boundaries through versioned document sessions. The focused editor owns the active buffer; the main process owns the baseline revision, serialized writes, external-change detection, and atomic save. A bounded active-file journal supports local crash recovery and is removed on save or discard rather than becoming another durable copy of project content.

The workspace file surface is single-document and working-path scoped. Search, file browsing, the active file, and recovery switch with the active session's checkout or Session worktree. Repository metadata remains repository-scoped; source reads and writes remain working-tree scoped. Identical relative paths in separate worktrees are separate documents.

Workspace file management is part of that same boundary. Create, rename, move, duplicate, reveal, and delete operate within one canonical working root. Rename/move retargets document identity; trash-first deletion and explicit overwrite/cross-workspace/permanent-delete confirmation keep mutations recoverable and visible. Watcher events from agents or external tools are coalesced into workspace-scoped file, editor, search, and git invalidation.

A document session also owns text fidelity metadata: supported encoding and BOM, line-ending mode, final-newline state, indentation, and tab width. The applicable EditorConfig chain is resolved within the active working root. Ambiguous decoding and mixed-line-ending normalization require visible user decisions instead of silent byte changes.

Theme packages, language packages, selections, and language associations have user-global defaults with optional project overrides. Settings imports enter the global user library; `.openwaggle/themes/` and `.openwaggle/languages/` remain portable project-local resources. Resolution is explicit and provenance-labelled, with a bundled theme or editable Plain Text as the terminal fallback.

### Providers And Models

Provider, model, auth, OAuth, and thinking-level metadata come from Pi through OpenWaggle-owned ports. Do not add a parallel OpenWaggle provider registry.

### MCP And Project Resources

Pi resource loading is the runtime source of truth. OpenWaggle injects project roots in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes, then strips implicit roots when Pi persists settings.

OpenWaggle's first-party MCP runtime owns protocol negotiation, transports, trust, auth, lifecycle, and context policy. Pi receives only the MCP tool projection for a run. MCP config precedence is documented in `docs/configuration.md`.

### OpenWaggle Extensions

OpenWaggle extension packages add desktop contributions and optional Pi runtime resources. Load `website/src/content/docs/extending/openwaggle-extensions.md` before changing extension discovery, lifecycle, SDK schemas, federated module rendering, agent-loop contributions, interaction bridging, package create/update/remove workflows, or extension QA fixtures. User-facing website docs are the source of truth. The existing `pnpm docs:generate` path derives `build/openwaggle-docs` from `website/src/content/docs/**` plus installed Pi docs for agent-facing installed documentation, instead of maintaining a second repository copy. Generated installed docs need a root index and topic aliases so agents can find docs without guessing paths. Runtime docs lookup should go through a typed docs discovery capability available to both extension code and OpenWaggle's self-modifying agent context. Extension package writes are OpenWaggle-owned workflows: extension code must not modify extension packages directly; agents can create, update, or remove packages only after user approval of the exact proposal, and global package changes require stronger global-impact confirmation.

Qualifying first-party extension payload surfaces use the same syntax infrastructure as the rest of the app. Third-party contribution code accesses it only through the framework-neutral host syntax capability or an official framework primitive such as `@openwaggle/extension-react` `SyntaxBlock`/`SourceView`. The extension supplies source plus an explicit canonical language or media type; the host owns theme selection, work scheduling, caching, limits, and fallback. Arbitrary extension-owned markup is not inspected or rewritten.

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

- **Pi**: Runtime kernel and source of truth for agent execution, native tools, sessions, providers, models, auth, and compaction.
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
- **Extension syntax capability**: The framework-neutral, host-backed SDK contract that renders or tokenizes explicitly typed source through OpenWaggle's syntax service without exposing its highlighter, worker, cache, or renderer internals.
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
- **Syntax-rendered content**: Text with an explicit or reliably derived language grammar, including workspace documents, fenced code, diffs, project-search snippets, and known-format structured payloads. It receives syntax highlighting; arbitrary monospace text, logs, errors, and terminal output do not unless explicit language metadata is present.
- **OpenWaggle theme package**: A versioned, stably identified theme artifact with metadata and optional Light, Dark, High Contrast Light, and High Contrast Dark payloads for Syntax themes and whole-app Appearance tokens. Syntax and Appearance remain separate layers but share discovery, import, persistence, and future distribution boundaries.
- **Appearance variant**: One of Light, Dark, High Contrast Light, or High Contrast Dark. It is the shared selection dimension for Syntax themes now and whole-app Appearance payloads later; imported VS Code collections retain every declared variant.
- **Theme preview transaction**: A temporary, reversible theme resolution used while navigating or validating the catalog. It affects representative previews but does not replace persisted selections until explicit commit; cancel or failure restores the prior resolved theme.
- **Theme import adapter**: A parser and validator that converts a supported external theme artifact into an OpenWaggle theme package without executing imported code. Initial adapters cover VS Code colour-theme files and theme extensions, TextMate themes, and native OpenWaggle packages.
- **Focused file edit**: The explicit editing state for the one active workspace file, available for text files no larger than 1 MiB.
- **Large-file source view**: The paged, read-only source representation for text files larger than 1 MiB, with external-editor handoff and no force-full-edit action.
- **Document edit session**: A versioned main/preload/renderer contract for one focused editable file. It serializes revision-checked writes, detects stale disk baselines, saves atomically, and owns bounded local recovery until save or discard.
- **Document text fidelity**: The encoding, BOM, newline, final-newline, indentation, and tab-width metadata preserved or explicitly transformed when a document session reads and writes source text.
- **Workspace file identity**: The canonical active-session working path and relative path used to isolate file discovery, search, the active file, document sessions, recovery journals, and file caches. It is distinct from repository identity.
- **Workspace file mutation**: A root-confined create, rename, move, duplicate, reveal, or delete operation against one workspace file identity, with explicit destructive/cross-workspace confirmation and coordinated document/cache retargeting.
- **Language grammar package**: A stably identified, declarative language contribution containing TextMate grammar data, aliases, file associations, embedded-language mappings, and optional language configuration. It may come from Shiki, VS Code/TextMate artifacts, or OpenWaggle packages and never implies executable extension features.
- **Language association**: An explicit filename or path-pattern mapping to a canonical language identity, used when automatic path and content detection is absent or incorrect.
- **Syntax resource scope**: The provenance and availability boundary of a theme, grammar, selection, or association. User-global resources apply across projects; project resources remain under `.openwaggle/` and override global defaults only for that project.
- **Syntax package revision**: The content-addressed revision of a stably identified theme or language package. It invalidates derived caches and workers while preserving selections tied to package identity.
- **External editor handoff**: Opening the exact active-worktree file and location in an installed editor for project-aware IDE capabilities that OpenWaggle does not provide.

## Skill Routing

- Use `diagnose` for bugs and regressions.
- Use `tdd` when implementation should start from a failing test.
- Use `improve-codebase-architecture` for deepening modules or architecture review.
- Use `to-prd` and `to-issues` for issue planning.
- Use `triage` for issue state movement.
- Use `zoom-out` when an agent needs a higher-level map before editing.
