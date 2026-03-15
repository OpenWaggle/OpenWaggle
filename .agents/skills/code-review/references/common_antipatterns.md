# Common Antipatterns

Patterns to flag during code review, organized by category.

## Design violations

- **God functions/classes** — single units handling multiple unrelated concerns.
- **Shotgun surgery** — a single change requires touching many unrelated files.
- **Feature envy** — a function heavily accesses another module's internals.
- **Primitive obsession** — using raw strings/numbers where domain types (branded IDs, enums, value objects) would prevent bugs.
- **Boolean blindness** — functions accepting multiple boolean parameters with unclear semantics.

## DRY violations

- **Copy-paste with variations** — duplicated logic with minor tweaks instead of parameterized abstractions.
- **Scattered constants** — the same magic number or string literal repeated across files.
- **Parallel hierarchies** — two file/class trees that must be kept in sync manually.
- **Premature abstraction** — abstracting before the pattern is clear (the cure is worse than the disease).

## Error handling

- **Silent swallowing** — bare `catch {}` blocks with no logging or re-throw.
- **String-based error matching** — checking `error.message.includes('...')` instead of typed errors.
- **Missing async error handling** — unhandled promise rejections or fire-and-forget async calls.
- **Overly broad catch** — catching all exceptions when only specific ones are expected.
- **Error as control flow** — using try/catch for expected conditions instead of explicit checks.

## State management

- **Stale closures** — event handlers or callbacks capturing outdated state in async flows.
- **Derived state stored** — storing computed values that could be derived on-the-fly.
- **Direct mutation** — modifying state objects in place instead of immutable updates.
- **Broad subscriptions** — subscribing to entire stores when only one field is needed.
- **Prop drilling** — passing data through many intermediate layers instead of using context/stores.

## Security

- **Missing input validation** — trusting external data without schema validation.
- **Auth check gaps** — protected operations missing authorization verification.
- **Secrets in client code** — API keys, tokens, or credentials in frontend bundles or logs.
- **Injection vectors** — unsanitized user input in SQL, shell commands, or HTML rendering.
- **Overly permissive defaults** — open CORS, disabled CSP, or unrestricted access.

## Performance

- **N+1 queries** — fetching related data one item at a time in a loop.
- **Missing cleanup** — subscriptions, timers, or listeners not disposed on teardown.
- **Unnecessary re-computation** — expensive calculations repeated when inputs haven't changed.
- **Synchronous blocking** — blocking the event loop or main thread with heavy computation.
- **Unbounded fetching** — loading all records without pagination or limit.
- **Premature optimization** — adding caching, throttling, or pooling without measured evidence of a problem.

## Testing

- **Happy-path only** — tests that only cover success scenarios, missing error/edge cases.
- **Implementation coupling** — tests that break on internal refactors because they test "how" not "what".
- **Timing-dependent assertions** — tests relying on `sleep()`, `networkidle`, or wall-clock timing.
- **Missing test updates** — behavior changes committed without corresponding test updates.
- **Test duplication** — multiple tests asserting the same behavior in slightly different ways.

## Async and concurrency

- **Race conditions** — concurrent operations on shared state without synchronization.
- **Retry without backoff** — infinite retry loops that amplify failures.
- **Fire and forget** — async operations started without awaiting or tracking completion.
- **Missing cancellation** — long-running operations that can't be stopped when no longer needed.
- **Stall vulnerability** — `await` on external calls without timeout protection.

## Code clarity

- **Magic numbers/strings** — unexplained literal values that should be named constants.
- **Deep nesting** — 4+ levels of conditionals/loops that should be flattened with early returns.
- **Long parameter lists** — functions taking 5+ arguments that should use option objects.
- **Dead code** — commented-out code, unused imports, or unreachable branches left in place.
- **Misleading names** — identifiers that don't match what the code actually does.
