# Adopt Feature-First Renderer Architecture

Status: accepted

OpenWaggle adopted a feature-first renderer architecture for `src/renderer/src/`. Renderer code is organized around product ownership in `features/<feature>/`, with route composition in `routes/`, reusable primitives in `shared/`, and app-frame composition in `shell/`. This replaced broad technical buckets that made ownership unclear and encouraged god components, prop drilling, broad Zustand subscriptions, and duplicated UI primitives.

The living renderer rulebook is `docs/renderer-architecture.md`. This ADR records the decision: features own their components, hooks, state, constants, commands, model types, pure logic, and colocated tests unless code is genuinely shared across features.

## Considered Options

- Keep technical buckets such as global `components/`, `hooks/`, `stores/`, and `lib/`. Rejected because they hide ownership and make cross-feature coupling cheap.
- Move all reusable-looking code to `shared/`. Rejected because shared code without clear primitive status becomes another dumping ground.
- Put route surfaces under an `app/routing` abstraction. Rejected because TanStack Router already gives the route boundary; route surfaces should stay route-adjacent.

## Consequences

- Cross-feature imports should use feature public indexes.
- Zustand stores are domain/feature-specific and use narrow selectors.
- Shared UI primitives are the default for repeated controls such as buttons.
- Tests are colocated with the feature folder or route folder they validate.
- Renderer boundaries and UI primitive usage are enforced through ESLint.
