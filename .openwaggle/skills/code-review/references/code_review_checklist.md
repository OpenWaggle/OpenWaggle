# Code Review Checklist

## Review order

1. Security and authorization.
2. Correctness and data integrity.
3. Test quality and coverage.
4. Design principles (SRP, DRY, SOLID).
5. Performance and resource management.
6. Maintainability and readability.

## Scope setup

- Compare against the project's main branch unless a different base is specified.
- Enumerate touched areas: frontend, backend, shared libraries, tests, config, docs.
- Tag risk level early (`low` / `medium` / `high`) based on auth/data/critical flow impact.

## Security checks

- Verify auth guards remain in sensitive write paths (API handlers, mutations, IPC handlers).
- Validate all external input at trust boundaries — schema validation, sanitization, or equivalent.
- Confirm secrets and credentials stay in secure modules — never in client-side or logged output.
- Check webhooks and callbacks for signature verification and structured failure handling.
- Flag command injection, SQL injection, and XSS vectors.
- Flag overly permissive access controls or missing rate limits.

## Correctness checks

- Confirm date/time and locale behavior around boundaries (timezones, midnight, DST).
- Verify async flows handle race conditions, cancellation, and cleanup.
- Ensure state mutations are safe — no shared mutable state without synchronization.
- Check boundary conditions: empty collections, null/undefined, zero, negative values.
- Verify error propagation — failures should reach appropriate handlers, not vanish.

## Design principle checks

### SRP
- Each function does one thing. Flag functions mixing concerns.
- Each module has one reason to change. Flag "god modules".

### DRY
- No duplicated logic across files. Flag copy-paste with minor variations.
- Constants and configuration centralized appropriately.

### Clean Code
- Names reveal intent. No abbreviations, no mystery parameters.
- Functions are short (<40 lines), low nesting (<3 levels), few parameters (<5).
- Comments explain "why", not "what". Flag stale or obvious comments.

### SOLID
- New abstractions follow Open/Closed — extend, don't modify.
- Interfaces are focused — no forcing consumers to depend on unused methods.
- Dependencies point toward abstractions, not concretions.

## Test checks

- Behavior changes require updated or new tests.
- Tests cover failure paths, edge cases, and boundary conditions — not just happy paths.
- For UI flow changes, require targeted E2E or visual regression coverage when impact is medium+.
- For utilities and logic, require unit tests plus type checks.
- Flag test duplication and brittle assertions (timing-dependent, order-dependent).

## Performance checks

- No unnecessary re-renders, re-fetches, or re-computations in hot paths.
- Subscriptions, timers, and listeners have cleanup on unmount/dispose.
- No O(n^2) patterns where O(n) is feasible.
- No synchronous blocking in async contexts.
- No unbounded data fetching without pagination.
- Only flag when evidence suggests real impact — avoid premature optimization.

## Error handling checks

- No bare `catch {}` blocks — always log or re-throw with context.
- Async rejections are handled or propagated.
- Error boundaries exist at appropriate service/component boundaries.
- Structured logging includes component, action, and error details.

## Output checks

- Findings first, sorted by severity (P0 → P3).
- Every finding includes `file:line` reference and violated principle.
- State explicitly when no findings are detected.
- Include residual risks and testing gaps after findings.
