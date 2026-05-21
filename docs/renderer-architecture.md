# Renderer Architecture

This document defines the renderer architecture for `src/renderer/src/`. It is the living reference for how renderer code is organized, tested, and enforced. The decision to adopt this shape is recorded in `docs/adr/0003-adopt-feature-first-renderer-architecture.md`.

## Architectural Goal

The renderer should scale by ownership, not by generic technical buckets. A feature should own its UI, state, hooks, commands, constants, pure logic, and tests unless that code is genuinely reusable outside the feature.

This keeps rendering boundaries narrow, makes state ownership explicit, and prevents large parent components or global stores from becoming orchestration hubs.

## Top-Level Shape

```txt
src/renderer/src/
  routes/      # TanStack Router route files and route-only surfaces
  features/    # product features with owned UI, state, hooks, logic, constants, tests
  shared/      # reusable renderer primitives with no product-domain ownership
  shell/       # app shell/layout composition around routes and features
  queries/     # shared TanStack Query client and cross-feature query options
```

Routes own route composition. They may import feature public APIs and shell components, but route surfaces stay route-adjacent instead of moving into an abstract `app/routing` layer.

## Feature Modules

A feature directory may contain these folders when they are needed:

```txt
features/<feature>/
  components/  # feature-owned React components
  hooks/       # feature-owned React hooks
  lib/         # pure helpers and domain logic for the feature
  state/       # focused Zustand stores and selectors
  model/       # feature-owned types and view models
  commands/    # command palette or user-action commands owned by the feature
  constants/   # object-based feature constants
  __tests__/   # tests colocated under the folder they validate
  index.ts     # explicit public API for cross-feature imports
```

Not every folder is required. Empty abstractions are worse than a smaller feature. Add folders when they separate responsibilities that already exist.

## Public API Rule

Cross-feature imports should go through the target feature's public index. Internal paths are implementation details.

Allowed:

```ts
import { useSessions } from '@/features/sessions'
```

Avoid:

```ts
import { useSessions } from '@/features/sessions/hooks/useSessions'
```

The purpose is not ceremony. The public index is the contract that lets a feature refactor internally without cascading imports across the renderer.

## Shared Renderer Code

`shared/` is not a second feature tree. It is for code that has no product-domain ownership and is reused by multiple features.

Use this shape:

```txt
shared/
  ui/       # reusable UI primitives such as Button, Textarea, Popover, Spinner
  hooks/    # generic hooks with no product-domain dependency
  lib/      # generic pure helpers and infrastructure helpers
```

Move code to `shared/` only when at least two features need it or when it is clearly a primitive. If a helper speaks in product terms such as session, provider, Waggle, composer, branch, or transcript, it probably belongs in a feature.

## Shell Code

`shell/` owns app-frame composition that is larger than a single feature but is not product-domain logic. Examples include root shell layout, persistent overlays, and app-level error boundaries.

Shell code may compose features. It should not own feature business logic or feature stores.

## State Ownership

Zustand stores are feature-owned by default. Stores should be small, focused, and named after the state boundary they own.

Rules:

- Use narrow selectors at call sites.
- Avoid `useStore()` without a selector.
- Do not create global dumping-ground stores.
- Do not mirror TanStack Query server/cache state into Zustand unless the renderer needs local interactive state.
- Keep branch/session/run state keyed by stable ids instead of by currently active route when background continuity matters.
- Prefer feature hooks that hide store wiring from presentation components.

A store belongs in `shared/` only when it is renderer infrastructure rather than product-domain state. That should be rare.

## TanStack Query

TanStack Query owns server-like async data fetched through IPC. Use reusable `queryOptions` factories instead of custom query hooks when possible.

Rules:

- Keep query keys stable and domain-named.
- Reuse query options from `queries/` or feature-owned query modules.
- Use TanStack Router loader/query integration for route data when a route needs preloaded data.
- Do not duplicate query data into Zustand for convenience.

## Components

Components should have one clear reason to change.

Rules:

- Prefer small presentation components plus focused controller hooks.
- Avoid components with many props; use feature state selectors or local composition when that models the state better.
- Do not pass large controller objects through deep trees.
- Use shared UI primitives instead of raw HTML controls when a primitive exists.
- Keep route-specific composition in `routes/` and feature-specific rendering in `features/<feature>/components/`.
- React Compiler is enabled; avoid `React.memo`, `React.FC`, and `forwardRef`.
- Use `useMemo` and `useCallback` only for semantic identity required by external APIs.

## Constants

Constants live in `constants/` modules when they are reused, domain-significant, or replace magic values. Prefer object-based exports so related constants are discoverable together.

Example:

```ts
export const ComposerConstants = {
  ContextMeter: {
    WarningThreshold: 0.75,
    DangerThreshold: 0.9,
  },
} as const
```

Avoid scattering reusable strings, dimensions, thresholds, labels, and storage keys inline through components.

## Testing

Tests live near the code they validate.

Rules:

- Component tests live under the owning component folder's `__tests__/`.
- Hook tests live under the owning hook folder's `__tests__/`.
- Pure logic tests live under the owning `lib/__tests__/` or `state/__tests__/`.
- Route-only tests may live in `routes/__tests__/` because TanStack Router files are route-owned.
- E2E tests stay under `e2e/`.

Test behavior through public interfaces where practical. Extract important logic from React components into hooks, stores, or pure modules before testing it.

## Enforcement

Renderer architecture is enforced through linting and verification:

- `openwaggle/renderer-import-boundaries` protects feature boundaries.
- `openwaggle/no-raw-renderer-buttons` pushes UI toward shared primitives.
- `openwaggle/jsx-max-props` discourages prop-drilled components.
- Type-aware ESLint and Biome enforce TypeScript and style constraints.
- React Doctor checks React Compiler compatibility and renderer anti-patterns.

Run `pnpm lint`, `pnpm test:component`, and React Doctor for renderer changes according to `.agents/verification.md`.
