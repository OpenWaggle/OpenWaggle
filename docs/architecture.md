# Architecture Index

This file is the entrypoint for OpenWaggle architecture documentation. It is intentionally an index, not a second canonical architecture description.

## Core Documents

- `CONTEXT.md` defines canonical OpenWaggle product-domain language.
- `docs/first-principles.md` defines the stable product and architecture principles.
- `docs/system-architecture.md` describes the current whole-system shape.
- `docs/hexagonal-architecture.md` defines main-process layering rules.
- `docs/renderer-architecture.md` defines renderer organization, state, UI, testing, and enforcement rules.

## Decision Records

ADRs live in `docs/adr/`. They explain why major architectural decisions were made; the architecture documents explain how the system works today.

- `docs/adr/0001-adopt-main-process-hexagonal-architecture.md`
- `docs/adr/0002-migrate-runtime-to-pi.md`
- `docs/adr/0003-adopt-feature-first-renderer-architecture.md`
- `docs/adr/0004-split-portable-waggle-core-from-pi-adapter.md`
- `docs/adr/0005-adopt-openwaggle-extension-contribution-host.md`
- `docs/adr/0006-adopt-federated-module-runtime-for-extension-ui.md`
- `docs/adr/0007-adopt-release-please-for-openwaggle-npm-packages.md`
- `docs/adr/0008-publish-npm-packages-directly-with-trusted-publishing.md`
- `docs/adr/0009-promote-attested-package-artifacts.md`
- `docs/adr/0010-adopt-worktree-per-session-environment-mode.md`
- `docs/adr/0011-per-turn-worktree-checkpointing.md`
- `docs/adr/0012-source-control-provider-cli-adapters-and-stacked-actions.md`
- `docs/adr/0013-adopt-first-party-mcp-integration.md`
- `docs/adr/0014-windows-mcp-stdio-sandbox.md`
- `docs/adr/0015-single-design-token-contract.md`
- `docs/adr/0016-adopt-pierre-diffs-renderer.md`
- `docs/adr/0017-remove-git-branch-administration-from-composer.md`
- `docs/adr/0018-session-keyed-git-state.md`
- `docs/adr/0019-pinned-sessions-stored-per-pin.md`
- `docs/adr/0020-sidebar-provenance-icon-vocabulary.md`
- `docs/adr/0021-status-colours-are-semantic-roles.md`
- `docs/adr/0022-transcript-opens-from-its-newest-end.md`
- `docs/adr/0023-agent-access-modes-and-declared-authorization.md`

## Testing

- `docs/git-behaviour-test-coverage.md` — which git, diff and worktree behaviours are covered, and by which test.

## Specs

Specs capture planned or in-progress product/runtime work. They may be more detailed than the stable architecture references and can become stale as implementation completes.

- `docs/specs/pi-migration-remaining-work.md`
- `docs/specs/pi-waggle-extension-package-spec.md`
- `docs/specs/issue-113-extension-host-ac-mapping.md`
- `docs/specs/waggle-composer-wireframes.md`

## User-Facing Docs

Published user-facing documentation lives under `website/src/content/docs/`.
