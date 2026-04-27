# First Principles

These are the foundational, irreducible principles that govern OpenWaggle's design. They are not features, behaviors, or implementation details. They are the stable truths from which the system's architecture follows.

---

## 1. Process isolation is the security boundary

Every capability the user-facing interface has must be explicitly granted through a typed bridge. No process may access another's runtime directly. Trust is structural, not conventional.

The renderer cannot call Node.js APIs, read files, or spawn processes. It can only invoke methods that the preload script chose to expose via `contextBridge`. The main process cannot reach into the renderer's DOM or state. The preload script has no business logic. This three-way separation means that a vulnerability in one process cannot escalate to another without crossing a typed, auditable interface.

---

## 2. Types are the contract

The system's correctness at integration boundaries depends on types being the single source of truth for what can be communicated. If the type system permits it, the system must handle it; if the type system forbids it, the system need not.

There is one file that defines all IPC channels, their argument types, and their return types. The preload bridge, the main process handlers, and the renderer's API calls all derive their signatures from this single definition. Branded types prevent accidental mixing of identifiers across domains. Discriminated unions enforce exhaustive handling of message parts, stream events, and error categories. Runtime validation exists at system boundaries, but compile-time types are the primary enforcement mechanism.

---

## 3. Pi is the runtime kernel

OpenWaggle does not recreate a coding-agent runtime beside Pi. Pi owns the core execution loop, session continuity, native tool surface, and runtime policy. OpenWaggle owns the UI, product projection, persistence read model, and explicit adapter boundaries around Pi.

Pi enters the application only through ports and adapters. Domain, application, IPC, shared, and renderer code use OpenWaggle-owned types; they do not import Pi SDK types or expose Pi SDK objects across process boundaries.

---

## 4. Runtime capabilities come from Pi first

The Pi-native baseline uses Pi's coding-agent tools and events. OpenWaggle presents the runtime truth Pi emits instead of duplicating tool execution or runtime policy in the product shell.

New capabilities must be introduced through explicit ports and Pi-native extension points, with a clear product reason.

---

## 5. State lives at the boundary it serves

Renderer state exists for the renderer. Persistence state exists for the main process. Shared types exist to align them. No process owns another's state; each process owns the state it needs to function.

The renderer maintains its own stores for UI state, streaming display, and user interaction. The main process owns the database, provider connections, and agent execution state. When data must cross the boundary, it is serialized through IPC with explicit types. There is no shared mutable state between processes. Each side is authoritative over what it manages.

---

## 6. Streaming is the primary data path

The system is designed around continuous, incremental delivery of information from main to renderer. Streaming is not an optimization applied to a request-response model; it is the fundamental communication pattern for agent execution.

The agent runtime emits transport events as they arrive from Pi. The renderer subscribes to these events and builds messages incrementally. Text, tool calls, errors, cancellation, and completion signals all flow through OpenWaggle-owned transport events. The UI renders partial state as it arrives rather than waiting for complete responses.

---

## 7. Every provider is equivalent in interface, not in capability

The system presents multiple LLM providers through Pi-aligned model/auth/runtime metadata. Provider-specific behavior is encapsulated at adapter boundaries; the application runtime does not branch on provider identity.

Provider/model/auth work should mirror Pi's capabilities where possible. OpenWaggle adds a polished settings UX over that runtime truth, not a separate provider runtime.

---

## 8. Explicit projection over hidden orchestration

OpenWaggle's product state is a typed projection over Pi sessions, nodes, and branches. There are no hidden sub-sessions, synthetic tool calls, or synthetic streams standing in for real runtime structure.

Waggle and future collaboration features must write into the same canonical session/tree model as standard mode. Branch-scoped product metadata belongs in SQLite projection tables; Pi remains the runtime/session authority.

---

## 9. The user remains in control through visible state

The user is the final authority through explicit mode selection, visible session/branch state, truthful tool rendering, stop/cancel controls, and project-local configuration.

If future runtime policy controls are added, they must be modeled explicitly and stay behind the Pi adapter boundary.

---

## 10. Errors are classified, not just caught

Errors carry semantic meaning that determines what the user can do about them. Error handling is about surfacing actionable information, not silent recovery.

Every error that crosses the IPC boundary is classified into a known category with a user-facing message and a retryability flag. The renderer uses this classification to decide whether to show a retry button, a settings link, or a plain error message. The classification is shared between processes so that the same error is described consistently regardless of where it was caught.
