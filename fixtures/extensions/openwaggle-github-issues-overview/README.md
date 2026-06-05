# GitHub Issues Overview Extension

Development-only fixture for validating federated-module settings and side panel surfaces with a
real public GitHub Issues read.

The settings surface fetches public issues from `https://api.github.com`, writes the repository
configuration and live issue summary into brokered project-scoped extension storage, and the side
panel refreshes and reads the same package state to prove multiple surfaces from one extension can
share package data.

Install fixtures into the current checkout with:

```bash
pnpm extension:qa:install
```

Then open Settings > Extensions, trust and enable `GitHub Issues Overview`, and reload the extension registry.
