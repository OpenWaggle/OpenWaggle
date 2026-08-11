# Migrate Runtime To Pi

Status: accepted; MCP ownership clauses superseded by ADR-0013

OpenWaggle migrated from owning a parallel coding-agent runtime to using Pi as the runtime kernel. Pi owns execution, sessions, tools, providers, models, provider auth, thinking levels, and compaction semantics. OpenWaggle owns the Electron product shell, renderer experience, SQLite projection, settings UX, and typed adapter boundaries around Pi. ADR-0013 supersedes this ADR's former assignment of MCP behavior to Pi extension packages: OpenWaggle now owns the first-party MCP integration while projecting its model-facing tools through Pi's supported extension boundary.

This decision prevents OpenWaggle from reimplementing agent-runtime policy beside Pi. Runtime truth should flow from Pi through OpenWaggle-owned ports and DTOs, then into renderer state and persistence projections.

## Consequences

- Provider/model/auth metadata comes from Pi, not a parallel OpenWaggle provider registry.
- Pi session data is the runtime source of truth; SQLite is a product read model.
- MCP ownership follows ADR-0013: OpenWaggle owns MCP lifecycle and policy, while Pi remains the only model loop and receives first-party MCP tools through an inline extension factory.
- OpenWaggle-specific behavior must enter through explicit ports, adapters, projections, or Pi extension points.
