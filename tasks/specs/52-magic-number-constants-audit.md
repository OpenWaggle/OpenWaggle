# Spec 52: Repository Magic Number Constants Audit

## Objective
Replace magic numeric literals across the repository with descriptive named constants, without changing behavior.

## Scope
- Source code files under `src/`, top-level config/runtime TypeScript files, and utility scripts in `scripts/`.
- Excludes tests and fixture-only literals where hardcoded values are intentional.
- Excludes literals `0` and `1` when meaning is self-evident for indexing/simple arithmetic/comparison.

## Plan
- [x] Identify candidate magic numbers across the repository
- [x] Classify findings (exclude tests and acceptable `0`/`1` usages)
- [x] Extract module-level constants for file-local usage
- [x] Extract shared constants only when values are reused across files with shared meaning
- [x] Replace usages without behavior changes
- [x] Run formatting/lint/type checks
- [x] Update this spec with review notes and results

## Verification
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [ ] `pnpm test`

## Review Notes
- Replaced inline numeric literals across non-test code paths with module-level `SCREAMING_SNAKE_CASE` constants.
- Added repository guardrail `scripts/check-magic-numbers.mjs` and wired it into `pnpm check` via `check:magic-numbers`.
- Consolidated repeated numeric constants into shared module [constants.ts](/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/src/shared/constants/constants.ts) and grouped related values into domain objects (`MATH_CONSTANTS`, `SIZE_CONSTANTS`, `TIME_CONSTANTS`) for DRY reuse across files.
- Migrated script checks from `.mjs` to TypeScript entrypoints (`.ts`) executed with `tsx` for consistent script authoring and typed maintenance.
- Validation:
  - `pnpm lint` ✅
  - `pnpm typecheck` ✅
  - `pnpm check:magic-numbers` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (score: 99/100, warnings only)
  - `pnpm test` ❌ fails in existing integration suites (`run-repository.integration.test.ts`, `conversations.integration.test.ts`, `sub-agent-lifecycle.integration.test.ts`) with persistence/runtime issues unrelated to magic-number refactor behavior.
