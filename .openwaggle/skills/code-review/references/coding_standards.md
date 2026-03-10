# Coding Standards

Universal standards applied during code review. Project-specific conventions should be read from `CLAUDE.md` or equivalent project instructions before reviewing.

## Baseline expectations

- Follow repository-local standards first (project instructions, linter config, existing patterns).
- Keep code deterministic, readable, and easy to reason about.
- Preserve explicit auth/access checks on protected paths.
- Keep generated files read-only unless regeneration is part of the change.

## Naming and readability

- Names reveal intent: `getUserPermissions()` not `getData()`.
- Booleans read as questions: `isActive`, `hasPermission`, `canEdit`.
- Avoid abbreviations unless universally understood (`url`, `id`, `http`).
- Functions describe actions: `calculateTotal()`, `validateInput()`, `sendNotification()`.
- Constants use SCREAMING_SNAKE_CASE. Variables use camelCase. Types use PascalCase.

## Function design

- Each function does one thing at one abstraction level.
- Target <40 lines. If longer, extract sub-functions.
- <5 parameters. Use option objects for complex configuration.
- Return early for guard clauses — avoid deep nesting.
- Pure functions where possible — minimize side effects.

## Error handling

- Never silently swallow errors. Log with context or re-throw.
- Validate at trust boundaries: user input, API responses, deserialized data.
- Use typed error hierarchies or discriminated unions — not string matching.
- Async failures must be caught and handled. No unhandled rejection risks.

## Type safety

- Prefer strict types over permissive ones (`unknown` over `any`).
- Use discriminated unions for variant data, not type assertions.
- Runtime validation at system boundaries (JSON parsing, IPC, external APIs).
- Let type inference work — don't annotate what the compiler already knows.
- Branded types for domain IDs prevent accidental ID mixing.

## State management

- Single source of truth for each piece of state.
- Immutable updates — never mutate state in place.
- Granular subscriptions — components should subscribe to exactly what they need.
- Derived state is computed, not stored.

## Async patterns

- Cancellation and cleanup for all subscriptions, timers, and listeners.
- Handle race conditions in concurrent flows (stale closures, out-of-order responses).
- Timeout protection for external calls that may hang.
- Retry logic with backoff for transient failures, not infinite loops.

## Security

- Input validation at every trust boundary.
- Auth checks on every protected operation — never assume upstream validation.
- No secrets in client-side code, logs, or error messages.
- Environment variables accessed through validated modules, not raw `process.env`.
- CSP, CORS, and other security headers configured restrictively by default.

## Testing

- Behavior changes require test updates. No exceptions.
- Test the contract, not the implementation — tests should survive refactors.
- Cover failure paths, edge cases, and boundary conditions.
- Tests are first-class code — same quality standards as production code.
- Prefer integration tests for critical paths, unit tests for logic branches.

## Performance

- Measure before optimizing — no premature optimization.
- Cleanup resources (subscriptions, listeners, timers) on component/service teardown.
- Avoid O(n^2) where O(n) solutions exist.
- Batch operations where possible (database queries, API calls, DOM updates).
- Lazy-load expensive resources and code-split large bundles.

## Architecture

- Respect process and module boundaries — no business logic in bridge/transport layers.
- Depend on abstractions, not concrete implementations.
- Keep shared types as the single source of truth for cross-boundary contracts.
- Changes to shared contracts must be wired consistently across all consumers.
