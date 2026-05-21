# Migrate Runtime To Pi

Status: accepted

OpenWaggle migrated from owning a parallel coding-agent runtime to using Pi as the runtime kernel. Pi owns execution, sessions, tools, providers, models, auth, MCP extension behavior, thinking levels, and compaction semantics. OpenWaggle owns the Electron product shell, renderer experience, SQLite projection, settings UX, and typed adapter boundaries around Pi.

This decision prevents OpenWaggle from reimplementing agent-runtime policy beside Pi. Runtime truth should flow from Pi through OpenWaggle-owned ports and DTOs, then into renderer state and persistence projections.

## Consequences

- Provider/model/auth metadata comes from Pi, not a parallel OpenWaggle provider registry.
- Pi session data is the runtime source of truth; SQLite is a product read model.
- MCP and future Waggle runtime behavior should be Pi-native extensions, not separate OpenWaggle loops.
- OpenWaggle-specific behavior must enter through explicit ports, adapters, projections, or Pi extension points.
