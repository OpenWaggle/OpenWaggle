# GitHub Issues Overview Extension

Development-only fixture for validating federated-module settings and side panel surfaces.

It does not call the GitHub network API yet. The settings surface writes a repository/label configuration and a deterministic issue summary into brokered project-scoped extension storage. The side panel surface reads the same package state to prove multiple surfaces from one extension can share package data.

Install fixtures into the current checkout with:

```bash
pnpm extension:qa:install
```

Then open Settings > Extensions, trust and enable `GitHub Issues Overview`, and reload the extension registry.
