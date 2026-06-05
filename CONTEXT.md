# OpenWaggle Context

OpenWaggle is an Electron desktop coding-agent workspace built on Pi. This glossary captures product-domain language that should stay stable across planning, issues, docs, and implementation.

## Language

**OpenWaggle extension package**:
A first-class local package that can add OpenWaggle desktop contributions and optionally Pi runtime resources.
_Avoid_: plugin, addon

**Development extension fixture**:
An extension package used only for local QA, tests, or demos and never shipped as product content.
_Avoid_: bundled extension

**OpenWaggle desktop contribution**:
A declared addition to an OpenWaggle-owned product surface.
_Avoid_: widget, plugin component

**Agent-loop contribution**:
An OpenWaggle desktop contribution that renders or collects feedback during an active Pi agent loop.
_Avoid_: OpenWaggle tool runtime, custom loop

**Display-only agent-loop contribution**:
An Agent-loop contribution that renders Pi agent-loop progress or results without collecting user feedback.
_Avoid_: passive tool

**Interactive agent-loop contribution**:
An Agent-loop contribution that renders a pending Pi interaction and returns a typed user response to the Pi agent loop.
_Avoid_: direct Pi mutation, renderer callback

**Pi interaction primitive**:
A Pi-native user interaction request such as confirm, select, input, editor, notify, or typed custom.
_Avoid_: extension-defined modal protocol

**Extension interaction schema**:
The public typed request-and-response contract for rendering Pi interaction primitives in OpenWaggle.
_Avoid_: undocumented payload shape

**Agent-loop event DTO**:
An OpenWaggle public data shape that preserves Pi agent-loop semantics for extension renderers without exposing Pi package internals.
_Avoid_: raw Pi SDK type in renderer

**Custom desktop interaction**:
A typed OpenWaggle rendering of a Pi custom interaction request for cases not covered by standard Pi interaction primitives.
_Avoid_: Pi TUI component in Electron

**Agent-loop fallback renderer**:
An OpenWaggle-owned renderer used when an Agent-loop contribution is missing, disabled, unsupported, or fails.
_Avoid_: silent failure, hanging tool UI

**Agent-loop binding identity**:
The Pi-native tool name or custom message type that an Agent-loop contribution renders.
_Avoid_: renderer-only event name, OpenWaggle tool id

**Extension contribution surface**:
The OpenWaggle-owned place where an extension contribution appears, such as a route, side panel, dialog, settings section, transcript card, or status widget.
_Avoid_: lane, slot

**Extension contribution container**:
The OpenWaggle-owned shell around mounted extension content, including placement, chrome, sizing, docking, and persistence rules.
_Avoid_: extension-owned shell

**Extension contribution runtime**:
The execution model OpenWaggle uses to load and mount a visual extension contribution.
_Avoid_: lane

**Extension execution placement**:
The runtime location where a visual extension contribution runs, such as the OpenWaggle renderer or an isolated frame.
_Avoid_: trust level

**Federated module runtime**:
The default visual extension contribution runtime where OpenWaggle loads an extension-provided module at runtime and gives it a mount context.
_Avoid_: trusted-react as the general term

**Extension mount context**:
The object OpenWaggle passes to a federated module so it can attach UI to a host-provided root and use the public extension SDK in any execution placement.
_Avoid_: props, renderer internals

**Composer extension surface**:
An OpenWaggle-owned compact composer-adjacent action surface for extension controls such as buttons, selectors, or launchers.
_Avoid_: arbitrary composer injection

**Transcript agent-loop surface**:
The durable chat-transcript surface for rendering Pi tool progress, tool results, approvals, and custom agent-loop messages.
_Avoid_: ephemeral-only tool UI

**Blocking agent-loop interaction**:
An Interactive agent-loop contribution that pauses Pi progress until the user responds.
_Avoid_: hidden prompt

**Extension SDK surface**:
The intentional public API exposed to extension code for capability calls, UI mounting context, theme data, and contribution behavior.
_Avoid_: OpenWaggle internals, renderer internals

**Extension author documentation**:
User-facing documentation for humans building OpenWaggle extension packages.
_Avoid_: ADR-only extension docs

**Agent-facing installed documentation**:
Build-produced package-local docs for self-modifying agents inspecting an installed OpenWaggle.
_Avoid_: hand-maintained duplicate docs

**Installed docs index**:
A generated entry point that maps common agent questions to package-local OpenWaggle and Pi documentation paths.
_Avoid_: hidden docs tree

**Docs discovery capability**:
A typed OpenWaggle capability that resolves installed and discovered documentation topics to local documentation paths and lightweight provenance metadata.
_Avoid_: hardcoded docs path, hidden local docs

**Docs discovery topic**:
A first-party typed topic that identifies an OpenWaggle or Pi documentation entry.
_Avoid_: free-form docs query

**Extension package documentation**:
Package-local documentation shipped by an OpenWaggle extension package in a Pi-style `docs/` directory.
_Avoid_: first-party docs override

**Self-modifying agent context**:
OpenWaggle-provided context that lets an agent inspect and change OpenWaggle itself using installed product documentation and runtime contracts.
_Avoid_: hidden self-knowledge

**OpenWaggle shared extension module**:
An optional host-provided module an extension can import for SDK, theme, or UI convenience when using a federated module runtime.
_Avoid_: required framework dependency

**Extension capability broker**:
The main-process authorization boundary for extension calls into OpenWaggle capabilities.
_Avoid_: direct IPC, direct store access

**OpenWaggle state read capability**:
A fully typed public SDK capability that lets extension code read or subscribe to selected OpenWaggle state without importing internal stores.
_Avoid_: direct OpenWaggle store access

**OpenWaggle action capability**:
A fully typed public SDK capability that lets extension code request an OpenWaggle behavior change without writing internal stores.
_Avoid_: writable OpenWaggle store access

**Extension package state**:
Extension-owned reactive in-memory state shared across all contributions from the same OpenWaggle extension package.
_Avoid_: global app store

**Extension contribution instance state**:
Extension-owned state scoped to one mounted contribution instance.
_Avoid_: package state

**Agent-loop durable state**:
Pi session data that can reconstruct historical agent-loop contributions after remount, route change, or app restart.
_Avoid_: renderer-only history

**Pending interaction state**:
OpenWaggle-owned live state for a Pi interaction request waiting for user feedback.
_Avoid_: extension-local pending prompt

## Relationships

- An **OpenWaggle extension package** declares zero or more **OpenWaggle desktop contributions** across one or more **Extension contribution surfaces**.
- A **Development extension fixture** may be copied into a project for manual QA, but it is not an installed or bundled product extension.
- An **OpenWaggle desktop contribution** has exactly one **Extension contribution surface**.
- An **Agent-loop contribution** is driven by Pi-native agent-loop events and rendered inside OpenWaggle-owned contribution containers.
- A **Display-only agent-loop contribution** observes Pi agent-loop events without returning feedback.
- An **Interactive agent-loop contribution** returns user feedback to the pending Pi interaction through the **Extension capability broker**.
- An **Interactive agent-loop contribution** renders a **Pi interaction primitive** through an **Extension interaction schema**.
- A **Custom desktop interaction** preserves Pi custom-interaction semantics without executing Pi TUI components in Electron.
- An **Agent-loop fallback renderer** must exist for standard **Pi interaction primitives**.
- A **Custom desktop interaction** uses an **Agent-loop fallback renderer** only to report unsupported or unavailable UI when no matching contribution can render it.
- An **Agent-loop event DTO** preserves **Agent-loop binding identity** while hiding Pi package internals from renderer extension code.
- An **Extension interaction schema** belongs to the public **Extension SDK surface**.
- An **Agent-loop contribution** declares an **Agent-loop binding identity** so Pi TUI and OpenWaggle desktop renderers stay aligned to the same runtime event.
- Multiple **Agent-loop contributions** may share one **Agent-loop binding identity** across different **Extension contribution surfaces**.
- The **Transcript agent-loop surface** is the durable fallback record for agent-loop feedback even when auxiliary surfaces such as dialogs, side panels, or status widgets are also used.
- A **Blocking agent-loop interaction** must be surfaced prominently while preserving a durable record in the **Transcript agent-loop surface**.
- An **Extension contribution surface** is rendered inside an **Extension contribution container**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension contribution runtime**.
- A visual **OpenWaggle desktop contribution** has exactly one **Extension execution placement**.
- A **Federated module runtime** receives an **Extension SDK surface** instead of importing OpenWaggle internals.
- A **Federated module runtime** may use **OpenWaggle shared extension modules**, but the required contract is the **Extension mount context**.
- A **Federated module runtime** starts by calling the extension module with an **Extension mount context**.
- The **Extension capability broker** authorizes calls made through the **Extension SDK surface**.
- **Extension author documentation** is the source of truth for the public **Extension SDK surface**.
- **Agent-facing installed documentation** is derived from user-facing OpenWaggle documentation at build or packaging time and exposed through a Pi-style package-local `docs/` directory.
- **Agent-facing installed documentation** includes the full OpenWaggle documentation set and installed Pi documentation so self-modifying agents can inspect product and runtime contracts locally.
- **Agent-facing installed documentation** starts at an **Installed docs index** with stable paths and topic aliases.
- A **Docs discovery capability** returns local paths, titles, anchors, keywords, aliases, and source metadata inside **Agent-facing installed documentation** for known documentation topics.
- A **Docs discovery capability** resolves closed first-party **Docs discovery topics** instead of arbitrary strings.
- A **Docs discovery capability** exposes discovered **Extension package documentation** through a structured extension namespace without allowing extensions to override first-party **Docs discovery topics**.
- **Extension package documentation** is discoverable regardless of trust or enablement, with trust, lifecycle, scope, package path, and content hash reported as provenance metadata.
- A **Docs discovery capability** is available to extension code through the **Extension SDK surface** and to OpenWaggle's **Self-modifying agent context**.
- An **OpenWaggle state read capability** exposes selected OpenWaggle state through the **Extension SDK surface**.
- An **OpenWaggle action capability** exposes selected OpenWaggle behavior changes through the **Extension SDK surface**.
- **Extension package state** can be shared by multiple **OpenWaggle desktop contributions** from the same package.
- Persistent extension data is written through typed storage capabilities, not by making **Extension package state** persistent by default.
- **Extension contribution instance state** belongs to exactly one mounted contribution instance.
- **Agent-loop durable state** is the source of truth for rendering historical **Agent-loop contributions**.
- **Pending interaction state** belongs to OpenWaggle while Pi is waiting for user feedback.
- **Extension package state** and **Extension contribution instance state** may enhance live rendering, but they are not **Agent-loop durable state**.
- OpenWaggle owns each **Extension contribution container**; the extension owns only the content mounted inside it.
- The **Composer extension surface** is constrained to compact actions and launchers instead of arbitrary composer input injection.

## Example dialogue

> **Dev:** "Should this extension add a route or a side panel?"
> **Domain expert:** "That is the **Extension contribution surface** decision; both can still use the same **Federated module runtime**."

> **Dev:** "Should this extension register its own OpenWaggle tool loop?"
> **Domain expert:** "No — it registers Pi-native tools and can add **Agent-loop contributions** so OpenWaggle renders progress, results, approvals, or feedback in desktop surfaces."

> **Dev:** "Should this transcript card bind to the extension contribution id?"
> **Domain expert:** "No — the **Agent-loop binding identity** is the Pi tool name or custom message type; the contribution id only identifies the OpenWaggle renderer entry."

> **Dev:** "Can the same Pi tool show a card in the transcript and details in a side panel?"
> **Domain expert:** "Yes — those are separate **Agent-loop contributions** sharing one **Agent-loop binding identity**, with the **Transcript agent-loop surface** preserving the durable record."

> **Dev:** "Can a renderer approve a tool call by mutating Pi state directly?"
> **Domain expert:** "No — an **Interactive agent-loop contribution** returns a typed response to the pending Pi interaction through the **Extension capability broker**."

> **Dev:** "Can an extension invent a modal payload that only OpenWaggle understands?"
> **Domain expert:** "Not for common cases — it should use a **Pi interaction primitive** with an **Extension interaction schema**, and only use typed custom when the primitive set is not enough."

> **Dev:** "Should OpenWaggle run a Pi TUI custom component inside Electron?"
> **Domain expert:** "No — it should render a **Custom desktop interaction** and return the typed result to Pi."

> **Dev:** "What happens if the extension renderer for a confirmation fails?"
> **Domain expert:** "The **Agent-loop fallback renderer** handles the standard **Pi interaction primitive** so the tool does not hang."

> **Dev:** "Should every user prompt render in the same place?"
> **Domain expert:** "No — a **Blocking agent-loop interaction** should be prominent, while the **Transcript agent-loop surface** keeps the audit trail."

> **Dev:** "Can the historical transcript depend on the side panel still being mounted?"
> **Domain expert:** "No — **Agent-loop durable state** reconstructs history; live extension state only enhances active surfaces."

> **Dev:** "Can an extension renderer import Pi SDK types directly?"
> **Domain expert:** "No — it consumes **Agent-loop event DTOs** that preserve Pi semantics through public OpenWaggle schemas."

> **Dev:** "Should we maintain separate human and agent docs in the repo?"
> **Domain expert:** "No — user-facing docs are the source of truth, and **Agent-facing installed documentation** is generated from them into a Pi-style package-local docs directory for installed builds."

> **Dev:** "How should an agent find the extension API docs in a packaged app?"
> **Domain expert:** "Start from the **Installed docs index**; it maps common topics to stable package-local paths."

> **Dev:** "Should an agent hardcode the packaged docs path?"
> **Domain expert:** "No — use the **Docs discovery capability** to resolve documentation topics to local paths."

> **Dev:** "Is docs discovery only for extensions?"
> **Domain expert:** "No — it also belongs in the **Self-modifying agent context** so agents can inspect installed OpenWaggle contracts."

> **Dev:** "Can an extension package ship docs?"
> **Domain expert:** "Yes — use **Extension package documentation** in a Pi-style package-local `docs/` directory, exposed through an extension namespace with provenance metadata."

> **Dev:** "Are untrusted extension docs hidden from docs discovery?"
> **Domain expert:** "No — local docs are discoverable; trust and lifecycle are metadata, not visibility gates."

## Flagged ambiguities

- "lane" was used to mean both placement and execution model. Resolved: use **Extension contribution surface** for placement and **Extension contribution runtime** for loading/execution.
- "trusted-react" was used as a general visual-extension model. Resolved: use **Federated module runtime** as the general model; framework choices such as React, Vue, Preact, or plain DOM are implementation choices inside the contribution.
- "custom tool UI" can imply a separate OpenWaggle tool runtime. Resolved: tools remain Pi-native; OpenWaggle extensions add **Agent-loop contributions** for desktop rendering and feedback.
- "tool renderer id" can mean either a UI contribution id or the runtime event it renders. Resolved: use **Agent-loop binding identity** for the Pi-native event and contribution id for the package-local UI entry.
- "interactive tool UI" can imply renderer-owned state mutation. Resolved: **Interactive agent-loop contributions** collect feedback, but responses return to Pi through the brokered interaction path.
- "custom interaction" can imply Pi TUI component execution. Resolved: OpenWaggle renders **Custom desktop interactions** instead of running Pi TUI components in Electron.
- "fallback" can imply best-effort logging only. Resolved: standard Pi interactions need functional **Agent-loop fallback renderers**; custom interactions without renderers fail explicitly instead of hanging.
- "shared extension state" can imply durable transcript state. Resolved: **Agent-loop durable state** comes from Pi session data; extension-owned state is reconstructable UI enhancement unless explicitly persisted through storage capabilities.
- "raw Pi event" can imply renderer imports from Pi packages. Resolved: renderer extension code consumes **Agent-loop event DTOs** with Pi-native identifiers preserved.
- "agent docs" can imply a second hand-maintained documentation tree. Resolved: **Agent-facing installed documentation** is generated from the user-facing docs and installed runtime docs.
- "installed docs" can imply a copied folder with no entry point. Resolved: installed docs must include an **Installed docs index** with predictable topic routing.
- "docs path" can imply a fixed filesystem location. Resolved: agents should use the **Docs discovery capability** instead of hardcoding packaged paths.
- "untrusted extension docs" can imply hidden local docs. Resolved: **Extension package documentation** is discoverable with provenance metadata regardless of trust or enablement.
