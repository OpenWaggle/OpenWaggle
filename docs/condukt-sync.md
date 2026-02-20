# Condukt Sync Workflow

This repository vendors `condukt-ai` in `packages/condukt-ai` using `git subtree`.

## Upstream assumptions

- Upstream repository: `https://github.com/diego-tech-dev/condukt-ai`
- Sync branch: an export branch where Condukt core content is at repository root.

## First-time setup

```bash
git remote add condukt-upstream https://github.com/diego-tech-dev/condukt-ai.git
git fetch condukt-upstream
```

## Pull updates (preferred)

```bash
git subtree pull --prefix packages/condukt-ai condukt-upstream openhive-core-export
```

If your upstream export branch uses a different name, replace `openhive-core-export`.

## One-time split fallback

If the upstream export branch does not exist yet, create it from upstream `packages/core`:

```bash
# In a temporary clone of condukt-ai
git subtree split --prefix=packages/core -b openhive-core-export
```

Then pull from that branch as shown above.

## Conflict policy

- `packages/condukt-ai/*`: prefer upstream behavior for generic orchestration/runtime.
- `packages/condukt-openhive/*`: keep OpenHive-specific adapters and policy mapping local.
- If both sides changed shared types, keep backward-compatible exports and add tests before merge.

## Upstream-first policy

Generic improvements to the runtime should be contributed in `condukt-ai` source and then synced into OpenHive by subtree pull.
