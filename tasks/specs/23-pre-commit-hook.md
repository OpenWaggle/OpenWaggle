# 23 — Pre-Commit Hook

**Status:** Planned
**Priority:** P4
**Severity:** Strategic
**Depends on:** None
**Origin:** H-13

---

## Problem

`pnpm check` runs `typecheck + lint` but there's no pre-commit hook enforcing it. Type errors and lint violations can be committed and only caught later.

## Implementation

- [ ] Add `lint-staged` + `husky` (or `lefthook` for lighter alternative)
- [ ] Pre-commit: run `biome check --staged` on staged files only (fast)
- [ ] Optionally: run `pnpm typecheck` as a pre-push hook (slower, but catches type errors before remote)
- [ ] Add `.husky/` or `lefthook.yml` to the repo

## Files to Touch

- `package.json` — add dev dependencies, lint-staged config
- `.husky/pre-commit` or `lefthook.yml` (new)

## Tests

- Manual: committing a file with lint errors is blocked
