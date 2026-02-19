# Code Review Checklist

## Review order
1. Security and authorization.
2. Correctness and data integrity.
3. User-facing behavior and regressions.
4. Test quality and coverage.
5. Maintainability and consistency.

## Scope setup
- Compare against `origin/main` unless a different base is required.
- Enumerate touched areas: frontend/app code, backend/services, shared libs, tests, config/docs.
- Tag risk level early (`low` / `medium` / `high`) based on auth/data/critical flow impact.

## Security checks
- Verify auth guards remain in sensitive write paths (API handlers, mutations, jobs, loaders).
- Validate untrusted input handling (schema validation, sanitization, or equivalent guardrails).
- Confirm secrets/env access patterns stay server-safe.
- Check external callbacks/webhooks for signature verification and structured failure handling.

## Correctness checks
- Confirm date/time and locale behavior, especially around `now`, weekend windows, and timezone boundaries.
- Verify dependency/invalidations when search/filter state drives data fetching.
- Ensure data queries use stable keys/arguments and do not churn every render.
- Watch for stale state or race conditions in async auth/loading flows.

## Frontend checks
- Confirm loading, empty, success, and error states are explicit.
- Validate keyboard/focus behavior for new interactive elements.
- Ensure fallback and retry states are reachable and coherent.
- Verify framework/compiler constraints are respected for this project.

## Backend/data checks
- Ensure schema migrations are safe for existing data.
- Confirm generated artifacts are not manually edited.
- Check index/query limits and pagination safety caps.
- Validate visibility filters and banned/suspended user handling in write operations.

## Testing checks
- Require updated tests for behavioral changes.
- For UI flow changes, request targeted E2E coverage when impact is medium/high.
- For utilities/backend logic, require unit tests plus type checks.
- Ensure assertions cover failure paths, not just happy paths.

## Output checks (Codex)
- Findings first, sorted by severity.
- Every finding includes `file:line` reference.
- State explicitly when no findings are detected.
- Include residual risks/testing gaps after findings.
