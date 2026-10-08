# Architecture Index

This file is the entrypoint for OpenWaggle architecture documentation. It is intentionally an index, not a second canonical architecture description.

## Core Documents

- `CONTEXT.md` defines canonical OpenWaggle product-domain language.
- `docs/first-principles.md` defines the stable product and architecture principles.
- `docs/system-architecture.md` describes the current whole-system shape.
- `docs/hexagonal-architecture.md` defines main-process layering rules.
- `docs/renderer-architecture.md` defines renderer organization, state, UI, testing, and enforcement rules.
- `docs/mcp-runtime.md` explains how the MCP runtime of ADR 0050 fits together: Pi's MCP client, the MCP transport layer, configuration files, and ports.

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
- `docs/adr/0025-adopt-visualize-compatible-inline-visualizations.md`
- `docs/adr/0026-unified-worker-backed-syntax-service.md`
- `docs/adr/0027-standards-first-language-grammar-import.md`
- `docs/adr/0028-prefer-review-first-workspace-files.md`
- `docs/adr/0029-tier-ci-gates-behind-a-merge-queue.md`
- `docs/adr/0030-session-bound-terminals.md`
- `docs/adr/0031-session-owned-browser-preview.md`
- `docs/adr/0032-coexisting-build-identities-and-channel-keyed-updates.md`
- `docs/adr/0033-remove-the-merge-queue.md`
- `docs/adr/0035-native-project-actions.md`
- `docs/adr/0036-bounded-sliding-transcript-window.md`
- `docs/adr/0037-derived-projections-never-cost-a-durable-turn.md`
- `docs/adr/0038-guided-action-panel.md`
- `docs/adr/0039-stop-the-session-host-from-the-command-line.md`
- `docs/adr/0040-adopt-the-v1-release-policy.md`
- `docs/adr/0041-forked-sessions-get-their-own-pi-entry-ids.md`
- `docs/adr/0042-cross-project-session-reach-and-session-scratch-directories.md`
- `docs/adr/0043-generated-session-titles-follow-t3code.md`
- `docs/adr/0043-unified-right-panel-with-a-panel-rail.md`
- `docs/adr/0044-follow-up-edits-keep-their-identity-and-hold-the-queue.md`
- `docs/adr/0044-usage-statistics-carry-no-persistent-identifier.md`
- `docs/adr/0045-usage-statistics-go-through-an-openwaggle-endpoint.md`
- `docs/adr/0046-usage-statistics-are-on-by-default.md`
- `docs/adr/0047-installing-an-update-releases-the-session-host.md`
- `docs/adr/0048-compacted-history-stays-visible-in-the-transcript.md`
- `docs/adr/0048-source-control-resolution-lives-in-the-session-host.md`
- `docs/adr/0049-pi-entry-ids-are-full-uuids.md`
- `docs/adr/0049-users-can-recover-desktop-tools-after-an-unclean-quit.md`
- `docs/adr/0050-openwaggle-is-the-gui-for-the-pi-ecosystem.md`

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
