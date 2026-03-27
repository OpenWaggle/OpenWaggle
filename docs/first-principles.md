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

## 3. The agent is a controlled loop, not a free executor

An LLM does not act autonomously. It proposes actions within a bounded iteration cycle, and each action is mediated by an approval gate, a tool definition, or a termination condition. The loop is the unit of control.

The agent loop has a hard iteration ceiling. Each iteration follows the same sequence: build context, call the model, process the stream, handle tool calls, check termination. There is no path by which the model can bypass this cycle, skip approval, or extend its own iteration budget. Control flow belongs to the loop, not to the model.

---

## 4. Tools are the only interface between the agent and the world

The agent cannot read files, execute commands, or affect state except through declared tools with explicit schemas. There is no ambient capability. Every side effect is named, typed, and gated.

Each tool declares its input schema, whether it requires user approval, and what context it needs. The agent loop validates inputs before execution and captures outputs after. There is no mechanism for the model to execute code, access the filesystem, or make network calls outside of a registered tool. The tool boundary is the complete surface area of agent capability.

---

## 5. State lives at the boundary it serves

Renderer state exists for the renderer. Persistence state exists for the main process. Shared types exist to align them. No process owns another's state; each process owns the state it needs to function.

The renderer maintains its own stores for UI state, streaming display, and user interaction. The main process owns the database, provider connections, and agent execution state. When data must cross the boundary, it is serialized through IPC with explicit types. There is no shared mutable state between processes. Each side is authoritative over what it manages.

---

## 6. Streaming is the primary data path

The system is designed around continuous, incremental delivery of information from main to renderer. Streaming is not an optimization applied to a request-response model; it is the fundamental communication pattern for agent execution.

The agent loop emits stream chunks as they arrive from the LLM. The renderer subscribes to these events and builds messages incrementally. Tool calls, approval requests, errors, and completion signals all flow through the same streaming channel. The UI renders partial state as it arrives rather than waiting for complete responses.

---

## 7. Every provider is equivalent in interface, not in capability

The system abstracts over multiple LLM providers through a uniform adapter interface. Provider-specific behavior is encapsulated within the adapter; the agent loop does not branch on provider identity.

A provider registers its models, declares its capabilities, and supplies an adapter factory. The agent loop resolves which provider owns a given model and creates an adapter. From that point forward, the loop treats all providers identically. Differences in API format, authentication, streaming behavior, or model capabilities are absorbed by the adapter, not by the calling code.

---

## 8. Composition over configuration

Features, tools, prompts, and skills are composed at runtime from discrete, declarative units. The system's behavior for a given run is the product of what was composed into it, not a static configuration that was toggled.

Agent features contribute prompt fragments, tools, tool filters, and lifecycle hooks. These are assembled per-run based on the conversation's context, active skills, project configuration, and sub-agent constraints. No single configuration file determines the agent's full behavior. The same agent loop can produce different capabilities depending on what features were composed into it.

---

## 9. The user is always the final authority

No irreversible action proceeds without explicit user consent. Approval is not a UX convenience; it is a structural property. The system distinguishes between actions that are safe to execute autonomously and those that require human judgment.

Tools declare whether they need approval. Project configuration can auto-approve specific patterns. But the default posture is to ask. The user can approve, deny, or cancel at any point. The agent loop pauses and waits. There is no timeout that auto-approves, no fallback that bypasses the gate.

---

## 10. Errors are classified, not just caught

Errors carry semantic meaning that determines what the user can do about them. Error handling is about surfacing actionable information, not silent recovery.

Every error that crosses the IPC boundary is classified into a known category with a user-facing message and a retryability flag. The renderer uses this classification to decide whether to show a retry button, a settings link, or a plain error message. The classification is shared between processes so that the same error is described consistently regardless of where it was caught.
