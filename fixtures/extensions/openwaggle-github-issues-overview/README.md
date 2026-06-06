# GitHub Issues Overview Extension

Development-only fixture for validating federated-module settings, side panel, and agent-loop
renderer surfaces with a real public GitHub Issues read.

The settings surface fetches public issues from `https://api.github.com`, writes the repository
configuration and live issue summary into brokered project-scoped extension storage. The side panel,
transcript, tool-card, custom-message, interaction, and status surfaces read the same package state
to prove multiple surfaces from one extension can share package data.

If GitHub is unavailable, settings and side-panel surfaces show a typed error or stored-summary
fallback. If GitHub returns no issues, the fixture renders an explicit empty state so the attempted
tool path is visible instead of pretending fake issue data exists.

Install fixtures into the current checkout with:

```bash
pnpm extension:qa:install
```

Then open Settings > Extensions, trust and enable `GitHub Issues Overview`, and reload the extension registry.
