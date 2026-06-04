# Adopt OpenWaggle Extension Contribution Host

Status: accepted

OpenWaggle will support first-class OpenWaggle extension packages that can extend desktop product surfaces and optionally include Pi runtime/resources. This is a top-level OpenWaggle package model, not only a Pi extension with extra metadata, because OpenWaggle needs desktop-only contributions such as commands, settings sections, side panels, dialogs, transcript/tool renderers, status widgets, extension routes, and other OpenWaggle-owned contribution surfaces.

The goal is Pi extension parity extended across OpenWaggle: extensions should preserve Pi-level runtime/resource modification power while gaining equivalent extension capability for OpenWaggle-owned desktop surfaces. Extensions are treated as trusted local software after explicit user approval; trust is tied to package identity, SDK compatibility, version, and content hash. Extension updates are always explicit user actions, and package signing is deferred until external publisher or marketplace distribution exists.

Extensions must integrate through the public OpenWaggle SDK/API. Trusted local main-process code and visual contribution modules may run after approval, but supported integration must not import OpenWaggle stores, renderer feature internals, Pi SDK internals, or Electron app internals directly. OpenWaggle owns startup resilience: extension failures must not prevent the app from starting, activation should be lazy by contribution/surface where practical, and recovery/disable controls remain OpenWaggle-owned.

## Consequences

- OpenWaggle needs an Extension Manager for discovery, lifecycle state, SDK compatibility checks, version/hash pinning, trust, enable/disable, update, reload, safe startup, and recovery.
- OpenWaggle needs a public Extension SDK/API plus brokered capability transport for app integration, while still allowing Pi-supported runtime/resource behavior to remain Pi-native.
- Renderer extension points should add or augment OpenWaggle-owned contribution containers on controlled surfaces, not replace core shell layout/navigation or provide app themes.
- ADR-0006 refines visual desktop contributions into `surface`, `runtime`, and `execution` concepts with a framework-neutral federated-module runtime as the default visual path.
- Extension package source may be project-local and committed, but trust records, permissions, enablement, local state, and project opt-outs stay user-local.
- The full implementation target is tracked in issue #113.
