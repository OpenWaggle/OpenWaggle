# Adopt OpenWaggle Extension Contribution Host

Status: accepted

OpenWaggle will support first-class OpenWaggle extension packages that can extend desktop product surfaces and optionally include Pi runtime/resources. This is a top-level OpenWaggle package model, not only a Pi extension with extra metadata, because OpenWaggle needs desktop-only contributions such as commands, settings sections, side panels, dialogs, transcript/tool renderers, status widgets, extension routes, and other OpenWaggle-owned contribution surfaces.

The goal is Pi extension parity extended across OpenWaggle: extensions should preserve Pi-level runtime/resource modification power while gaining equivalent extension capability for OpenWaggle-owned desktop surfaces. Extensions are treated as trusted local software after explicit user approval; trust is tied to package identity, SDK compatibility, version, and content hash. Extension updates are always explicit user actions, and package signing is deferred until external publisher or marketplace distribution exists.

Extensions must integrate through the public OpenWaggle SDK/API. Trusted local main-process code and visual contribution modules may run after approval, but supported integration must not import OpenWaggle stores, renderer feature internals, Pi SDK internals, or Electron app internals directly. OpenWaggle owns startup resilience: extension failures must not prevent the app from starting, activation should be lazy by contribution/surface where practical, and recovery/disable controls remain OpenWaggle-owned.

## Consequences

- OpenWaggle needs an Extension Manager for discovery, lifecycle state, SDK compatibility checks, version/hash pinning, trust, enable/disable, update, reload, safe startup, and recovery.
- OpenWaggle needs a public Extension SDK/API plus brokered capability transport for app integration, while still allowing Pi-supported runtime/resource behavior to remain Pi-native.
- Renderer extension points should add or augment OpenWaggle-owned contribution containers on controlled surfaces, not replace core shell layout/navigation or provide app themes.
- Agent-loop UI should preserve Pi-native tool names and custom message types as the semantic binding identity, so Pi TUI behavior and OpenWaggle desktop rendering are two presentations of the same runtime event rather than separate tool systems.
- Interactive agent-loop UI should return typed user feedback to pending Pi interactions through OpenWaggle's brokered extension path, not by letting renderer modules mutate Pi state or internal stores directly.
- OpenWaggle should expose Pi-native interaction primitives as public typed schemas and user-facing extension documentation, matching Pi's local extension documentation style and keeping the installed Pi package docs as the reference for Pi semantics.
- Standard Pi interaction primitives must have OpenWaggle-owned fallback renderers so extension UI failures do not hang tools or block agent-loop recovery; custom interactions without a matching renderer fail explicitly.
- Historical agent-loop rendering should be reconstructed from Pi session data, while OpenWaggle owns live pending-interaction state until Pi receives the user response.
- Extension renderer code should consume OpenWaggle public DTOs rather than Pi package types, with Pi-native identifiers and semantics preserved at the adapter boundary.
- OpenWaggle documentation should have one repository source of truth in the user-facing docs; build or packaging steps should derive a Pi-style package-local docs directory with the full OpenWaggle docs and installed Pi docs so self-modifying agents can inspect product, extension, and runtime contracts from an installed app.
- Installed docs must be self-describing and easy to navigate, with a root index, stable topic paths, and aliases for common agent tasks such as extensions, tools, interactions, sessions, settings, providers, and Pi runtime behavior.
- OpenWaggle should expose a typed docs discovery capability that resolves known documentation topics to local installed documentation paths plus lightweight metadata such as titles, anchors, aliases, keywords, and source, so agents do not hardcode source or packaged filesystem layouts.
- Docs discovery should be available through the extension SDK and through OpenWaggle's internal self-modifying agent context, with the main process as the source of truth for resolving source, dev, and packaged paths.
- First-party docs discovery topics should be a closed typed union so generated docs indexes, extension SDK calls, and self-modifying agent context can be validated without typo-prone free-form strings.
- Extension packages may ship package-local documentation in a Pi-style `docs/` directory. Docs discovery exposes discovered extension docs through a structured extension namespace regardless of trust or enablement, with trust/lifecycle/scope/package-path/content-hash metadata for provenance, but extension docs must not override first-party OpenWaggle or Pi docs topics.
- ADR-0006 refines visual desktop contributions into `surface`, `runtime`, and `execution` concepts with a framework-neutral federated-module runtime as the default visual path.
- Extension package source may be project-local and committed, but trust records, permissions, enablement, local state, and project opt-outs stay user-local.
- The full implementation target is tracked in issue #113.
