# 08 — Pin Dependency Versions

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-05

---

## Problem

`package.json:45-53` — all `@tanstack/ai-*` packages use `^0.5.x` ranges. These are pre-1.0 libraries where semver `^` allows any `0.x` minor bump, which in pre-1.0 semver can contain breaking changes. Same issue with `@xenova/transformers@^2.17.2`.

## Implementation

- [ ] Pin all `@tanstack/ai-*` packages to exact versions (e.g., `"0.5.0"` not `"^0.5.0"`)
- [ ] Pin `@xenova/transformers` to exact version
- [ ] Add a Renovate/Dependabot config or a monthly manual update cadence
- [ ] Document the pinning rationale in `package.json` or CLAUDE.md

## Files to Touch

- `package.json` — change version ranges to exact pins

## Tests

- Verify: `pnpm install` succeeds with pinned versions
- Verify: `pnpm typecheck` and `pnpm test` pass

## Risk if Skipped

A `pnpm update` or fresh install pulls a breaking TanStack minor version, causing silent adapter failures.
