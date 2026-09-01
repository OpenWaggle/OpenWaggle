# Adopt Visualize-Compatible Inline Visualizations

Status: accepted

OpenWaggle will support Visualize-compatible Inline visualizations as untrusted, interactive transcript content. An authenticated agent writes a durable HTML fragment, emits the documented structured `visualize` content reference, and OpenWaggle renders the live source in a uniform sandbox with the documented Visualize authoring and host environment. Compatibility applies to the public authoring contract, not to Codex-private directives, sandbox APIs, or renderer internals.

## Context

The bundled Visualize capability is more than an HTML preview. It defines an end-to-end contract: where an agent writes a fragment, how it references that fragment from a response, which resources and interactions the fragment may use, what the host injects, how the frame sizes and responds to theme changes, and how a user revisits, repairs, copies, exports, or publishes the result.

OpenWaggle currently has no semantic transcript part for this contract. Completed and streaming assistant text is rendered as sanitized Markdown, which correctly removes scripts and unsafe URLs. Session resources, workspace-file previews, MCP App frames, and extension contribution frames provide adjacent capabilities, but none has the right combination of transcript semantics, source ownership, trust, persistence, and host API. Treating a visualization as any of those would either disable its intended interaction or grant it unrelated authority.

The Codex desktop implementation is the behavioral reference. Its observable behavior answers the general product and security questions; OpenWaggle-specific extension and runtime boundaries remain OpenWaggle decisions. The compatibility target must therefore preserve the documented wire and host contract while fitting ADR 0001's main-process authority, ADR 0002's adapter boundary, ADRs 0005 and 0006's extension model, and ADR 0023's declared-purpose interaction rules.

## Decision

### Compatibility surface

- OpenWaggle recognizes the documented `visualize{"path":"<absolute-path>/<name>.html"}` content reference and its documented optional `title` and `mode: "wide"` attributes.
- The source is an HTML fragment, not a complete document. The authoring contract keeps it below 1 MB, uses a lowercase hyphenated `.html` filename, emits the absolute executor-side path, and emits the reference again whenever the source is created or updated.
- The host treats 5 MB as the defensive read ceiling. A larger source fails explicitly even though conforming authors stay below the lower authoring limit.
- A partial reference is withheld while streaming. It becomes transcript content only when syntactically complete; malformed or unsupported references never start a frame.
- Compatibility is runtime-neutral. Any authenticated agent runtime may produce the reference when its session can write the source to a host-authorized root. Pi is the first adapter, not part of the visualization contract.
- The compatibility promise covers the documented authoring rules, content reference, theme variables, utility environment, Lucide runtime, host interactions, sizing behavior, and CDN allowlist. Codex-private directives and internal sandbox protocols are not compatibility surfaces.

### Live source and session ownership

- The referenced file remains the live Inline visualization source. OpenWaggle does not create an immutable per-message snapshot. Revisiting the transcript reads the current file, so an update to the same path updates the visualization.
- The source is logically bound to the producing session and execution host. A session switch never reinterprets the path relative to the newly active session.
- The preferred physical location is the session-scoped visualization directory. A source in the producing session's workspace or another explicitly writable runtime root is also valid, matching the Visualize fallback contract.
- Every read is authorized in the main process. It normalizes the path, confines it to an allowed root, rejects parent traversal and symbolic links in the path, validates the filename, and reads through the owning execution host. Renderer possession of a path is not filesystem authority.
- Renderer caching is only a presentation optimization. Reload, remount, or later replay may read the live source again.
- Inline visualization sources survive application restart, session switching, and archive. The session-scoped visualization directory is removed when the session is deleted. A fork or handoff retains explicit source-session attribution rather than silently adopting the active session's authority.

### Sandbox and network policy

- Agent-authored fragments are untrusted even when the producing agent, skill, extension, or project is trusted. They never enter the transcript DOM through the Markdown renderer.
- Scripts may run only inside a sandboxed, origin-isolated frame. Every mounted frame receives a fresh, unguessable custom-protocol host so sibling visualizations do not share an origin. The fragment receives no Node.js, Electron, preload, filesystem, generic IPC, parent-DOM, top-navigation, popup, or arbitrary tool authority.
- The sandbox uses a deny-by-default CSP. Arbitrary connections are blocked; `connect-src` is limited to `blob:` and `data:`. Frames, objects, base-URI changes, and form submission are blocked. Unknown messages and host calls are ignored or rejected.
- Static scripts, styles, images, fonts, and media may load only from `cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, and `fonts.bunny.net`, plus the documented inline, `blob:`, and `data:` cases. Relative local resources are not resolved through filesystem access.
- Referrer information is suppressed. External navigation is brokered by the host and uses an explicit external-navigation confirmation where Codex does.
- CDN resources may be unavailable offline. The fragment, inline data, bundled utilities, theme, and icons must still produce a useful first render without remote access whenever the authored visualization permits it.
- The Inline visualization environment is versioned and OpenWaggle-owned. Installed extensions cannot add globals, origins, styles, IPC methods, capabilities, or permissions to it.

### Host environment and interaction

- The host supplies the documented theme variables, visualization series variables, utility classes, current light or dark appearance, locale, time zone, device capabilities, safe-area and container dimensions, and the global Lucide runtime. Theme and width changes are propagated to the running frame.
- Normal mode is designed around a 736 px content width. `mode: "wide"` enables the documented expandable surface up to 1,024 px; it does not silently widen every visualization.
- The frame reports intrinsic height to the host. The host sizes the transcript surface to content, caches measured height where useful, and caps reported height at 10,000 px. The fragment should reflow instead of relying on fixed outer widths, viewport-height layouts, or nested scrolling.
- The host provides an accessible frame title, preserves keyboard and focus boundaries, and exposes loading and error states as accessible UI. The authoring contract remains responsible for semantic controls, labels, non-hover access, dynamic announcements, reduced motion, contrast, and useful narrow-width layouts.
- Presentation-only interaction stays local to the frame. `window.openai.sendFollowUpMessage` is the documented bridge for asking the active agent to investigate a selected state; it is brokered and confirmed rather than mutating session state directly.
- Inline visualizations cannot call arbitrary tools. Downloads use a narrow host capability, external links use the host navigation path, and unsupported calls fail closed.
- The host may offer Codex-parity actions such as expand, copy as image, ask the agent to repair a failure, and publish through Sites when that capability is available.

### Producers, replay, failure, and export

- The Inline visualization producer is the authenticated agent turn whose transcript contains the structured reference. An OpenWaggle extension may provide skills, tools, or runtime resources that help the agent author the source, but renderer or extension-frame code cannot inject an Inline visualization directly into transcript history.
- Historical rendering is reconstructed from the persisted transcript reference plus the live, authorized source. It never depends on an extension frame remaining mounted.
- Missing, unreadable, rejected, oversized, timed-out, and crashing visualizations produce a stable fallback. The transcript does not disappear or execute the fragment outside the sandbox. When an agent is available, the host may offer the Codex-parity repair flow; dismissal does not alter transcript history.
- The host performs a post-load health check. A frame that self-navigates, becomes unresponsive, or stops speaking the host protocol is replaced by the same stable fallback, even when Chromium does not emit a cancellable frame-navigation event.
- Export is explicit. The live fragment remains the editable inline source; standalone export wraps it as a complete document and replaces any host-only interaction. Publishing uses Sites when available and otherwise produces or offers standalone HTML without claiming it is hosted.
- Sharing transcript text or a structured reference does not grant another machine filesystem authority. A portable visualization is created through explicit standalone export or publication.

## Consequences

- Inline visualizations become a first-class transcript concept rather than an exception inside Markdown, an attachment preview, an MCP App, or an extension frame.
- Historical visual output is intentionally mutable: replay shows the current live source, not necessarily the pixels seen when the message first arrived. This matches Visualize behavior and makes agent-authored iteration natural, at the cost of deterministic replay.
- The exact CDN allowlist is an accepted compatibility and availability tradeoff. Arbitrary connections remain denied, but allowed static requests mean the feature is not fully network-silent or fully offline.
- Main-process path validation, a separate sandbox boundary, and brokered host interactions remain mandatory even in YOLO (Full Access). External navigation and follow-up confirmation are user-input or navigation decisions, not agent authorization requests that Full Access may answer.
- Per-frame custom-protocol hosts are the origin-isolation boundary. OpenWaggle intentionally omits `Origin-Agent-Cluster` from visualization responses because Electron 43 can stall custom-protocol frame navigation when that header is present; origin separation does not depend on process clustering.
- A visualization produced on another execution host remains owned and read on that host. Losing the host or deleting the source yields the normal fallback rather than widening local filesystem authority.
- Extensions cannot create privileged visualization variants. The same fragment has the same runtime authority regardless of which extensions are installed, and historical transcript state remains reconstructable from the agent runtime.
- Future changes that widen origins, host APIs, producer authority, persistence semantics, or accepted wire forms require a deliberate compatibility and security decision rather than an incidental renderer change.

## Alternatives Considered

**Render agent HTML through sanitized Markdown.** Rejected because sanitization correctly removes the scripts needed for interaction, while weakening it would expose the parent transcript DOM and application origin.

**Capture an immutable source snapshot for each reference.** Rejected because it diverges from Visualize's editable live-source behavior. A snapshot would improve deterministic replay and simplify sharing, but updating a visualization would no longer update the referenced source.

**Forbid all remote resources.** Rejected in favor of parity with the documented CDN allowlist. A fully offline contract would reduce network exposure but break conforming Visualize fragments that use approved, version-pinned libraries.

**Reuse the extension-frame or MCP App host.** Rejected because those surfaces have different producer identities, trust decisions, protocols, and capabilities. Sharing low-level sandbox machinery is allowed; sharing their authority model is not.

**Allow extensions to inject or augment visualizations directly.** Rejected because it would create transcript history outside the authenticated agent stream, make replay depend on installed packages, and let extension presence change fragment authority.

**Clone Codex's private renderer protocol.** Rejected because private directives and sandbox APIs are not stable compatibility contracts. Codex behavior informs OpenWaggle's defaults; the documented Visualize authoring and host contract is the boundary OpenWaggle promises.
