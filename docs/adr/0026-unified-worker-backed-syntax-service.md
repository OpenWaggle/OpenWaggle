# Unified Worker-Backed Syntax Service

Status: accepted

OpenWaggle centralizes non-editable syntax highlighting behind one renderer infrastructure service with worker scheduling, shared language and theme registries, caching, cancellation, and priority. Product components do not instantiate or manage Shiki highlighters directly.

## Context

Syntax-rendered content appears in several independently owned features: transcript Markdown, tool details, workspace previews, project search, diffs, and the workspace editor. The current renderer already has separate paths: a global Shiki singleton for selected Markdown, Pierre's highlighter lifecycle for diffs, a synchronous textarea overlay for one JSON editor, and plain rendering elsewhere. Theme choice is hardcoded in one path and configurable in another.

Repeating highlighter creation, language aliases, theme resolution, caching, and fallback policy in each surface would produce inconsistent output and duplicate expensive work. Shiki tokenization is regular-expression based and can be CPU-intensive, so allowing feature components to invoke it on the renderer thread also makes performance depend on which surface happened to implement highlighting.

The lightweight Source view remains responsible for virtualized review rendering under ADR 0028. Pierre owns focused editable document state and diffs. Both use the same canonical language identities and normalized Syntax themes as other syntax-rendered surfaces.

## Decision

**One renderer syntax service owns shared infrastructure.** The service owns the canonical language registry and aliases, normalized theme registry, lazy language/theme loading, one lazy worker, request priority, cancellation, bounded caches, and structured failure reporting. It consumes only validated OpenWaggle theme packages.

The language registry exposes every bundled Shiki language through lazy loading and accepts validated declarative grammar packages under ADR 0027. Unknown or failed grammars resolve visibly to Plain Text without preventing editing.

**Features request results through surface adapters.** Chat Markdown, workspace source views, tool renderers, search snippets, typed MCP/extension/configuration/resource payloads, and other syntax-eligible surfaces call focused adapters over the service. Components do not import highlighter construction APIs, create workers, or invent local language/theme fallback rules. Structured payloads may lead with a compact tree or table, but expose a highlighted source representation when their language or media type is known. Pierre receives resolved language, theme, and worker data through its adapter rather than becoming the global registry.

**Extensions receive the host capability, not the highlighter implementation.** Every qualifying first-party surface must migrate to the shared service. The framework-neutral Extension SDK exposes a typed, host-backed syntax capability, and `@openwaggle/extension-react` provides a `SyntaxBlock`/`SourceView` primitive over it. Extensions submit source text plus a canonical language identity or media type; they do not submit executable highlighting code or pre-highlighted HTML. The host retains theme resolution, scheduling, cancellation, limits, caching, diagnostics, and plain-text fallback. OpenWaggle does not rewrite arbitrary extension-owned markup, so third-party consistency requires opting into the public capability or primitive.

**Pierre shares contracts, not registry ownership.** Pierre diffs and focused edits use the canonical language registry and active theme package. Its one-worker pool exists only for the lifetime of an explicit focused editor, while ordinary source review uses the shared worker. Imported grammars never execute on the renderer thread; worker failure removes highlighting while leaving the file readable and editable as Plain Text. The grammar registry pins JavaScript or Oniguruma WASM engine identity per revision under ADR 0027.

**Scheduling reflects user visibility.** The active file and visible content outrank near-viewport work; near-viewport work outranks offscreen precomputation. Superseded streaming and editing requests are cancelled by revision. No feature may bypass the scheduler for a large synchronous highlight on the renderer thread.

**Live fenced code preserves stable transcript work.** The incremental Markdown pipeline freezes completed prefixes and submits only the active tail through the shared syntax scheduler. A superseded active-block request is cancelled, the last readable presentation stays mounted while replacement tokens are pending, and the completed block enters the normal shared cache. The first implementation may re-tokenize the bounded active block; it must not reparse or re-render the stable transcript prefix.

**Caches are bounded and complete.** Cache identity includes content hash and length, canonical language, theme package identity and revision, renderer/highlighter version, and output-affecting options. Theme changes invalidate themed output without discarding unrelated language loading. Failed and unsupported-language requests return visible plain-text fallbacks and structured diagnostics rather than breaking the surface.

## Consequences

Syntax highlighting becomes explicit renderer infrastructure under `shared/`, with feature-owned adapters where product-specific transformations are needed. Worker protocol schemas and results are runtime boundaries and require validation and focused tests.

The service adds coordination complexity, but gives OpenWaggle one place to enforce memory bounds, performance instrumentation, cache policy, language behavior, theme invalidation, and graceful fallback. A surface that needs a new syntax treatment extends the service contract instead of adding another highlighter.

The public extension contract changes with this feature. The Extension SDK capability, React primitive, API snapshots, compatibility tests, package release intent, and extension-author documentation must move together. Extensions remain isolated from renderer internals and cannot instantiate or control the host worker pool.

Theme import and removal must invalidate or replace active worker theme registrations safely. Worker lifecycle and dynamic imports must be verified in both development and packaged Electron builds.

Performance is a merge gate for this infrastructure. Verification must cover cold and warm grammar loads, cache hits and eviction, active streaming, editor input, scrolling, theme switches, representative large files, pathological long lines, cancellation, worker recovery, and bounded memory. Qualitative smoothness is not sufficient evidence.

T3 Code and the installed Codex GUI are measured once with the same fixtures to establish the initial bar. OpenWaggle then owns the permanent fixtures, traces, and fixed budgets; CI does not depend on mutable external products. The measurement tiers and evidence requirements live in `docs/specs/syntax-highlighting-performance.md`.

## Alternatives Considered

**Let each feature own a Shiki integration.** Rejected. It repeats expensive instances and policy, makes theme behavior inconsistent, and cannot coordinate priority or memory across surfaces.

**Run highlighting in the main Electron process.** Rejected. Syntax rendering is renderer presentation infrastructure; moving it into main adds IPC volume and couples app responsiveness to presentation work.

**Force every surface through Pierre.** Rejected. Pierre is the correct diff and focused-edit renderer, but review source, Markdown, compact snippets, streaming blocks, and structured payloads have different output and lifecycle needs. They should share registry and scheduling policy rather than one component abstraction.

**Keep synchronous highlighting on the renderer thread.** Rejected for user-provided documents and streaming content. A cache miss or pathological grammar must not block input, scrolling, or run controls.
