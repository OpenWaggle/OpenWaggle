# Architecture Index

This file is the entrypoint for OpenWaggle architecture documentation. It is intentionally an index, not a second canonical architecture description.

## Core Documents

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

## Specs

Specs capture planned or in-progress product/runtime work. They may be more detailed than the stable architecture references and can become stale as implementation completes.

- `docs/specs/pi-migration-remaining-work.md`
- `docs/specs/pi-waggle-extension-package-spec.md`
- `docs/specs/waggle-composer-wireframes.md`

## User-Facing Docs

Published user-facing documentation lives under `website/src/content/docs/`.
