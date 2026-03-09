# 60 — Node 24 Standardization

**Status:** Done
**Priority:** P3
**Severity:** Low
**Category:** Fix
**Depends on:** None
**Origin:** User request (2026-03-09)

---

## Problem

The repository is effectively running on Node 24 locally, but the project does not declare that baseline anywhere. There is no checked-in Node version file, no `engines.node` constraint in `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/package.json`, and the docs still describe the requirement as `Node.js 20+` in `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/README.md`, `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/docs/user-guide/getting-started.md`, and `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/docs/user-guide/developer-guide.md`.

This leaves contributors with ambiguous setup guidance and allows install/build drift across Node majors even though the Electron 40 toolchain already aligns with Node 24.

## Implementation

### Phase 1: Repo Pinning
- [x] Add a repo-level Node version file for local version managers.
- [x] Add an explicit `engines.node` constraint in `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/package.json`.

### Phase 2: Documentation
- [x] Update contributor-facing docs to say `Node.js 24.x`.
- [x] Keep wording aligned across README and user-guide docs.

## Tests

- Verification: `node -v`
- Verification: `pnpm check:fast`

## Review

- Added `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/.nvmrc` and `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/.node-version` with `24`.
- Added `engines.node: ">=24 <25"` in `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/package.json`.
- Updated Node prerequisite wording in `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/README.md`, `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/docs/user-guide/getting-started.md`, and `/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/docs/user-guide/developer-guide.md`.
- Verified local runtime with `node -v` → `v24.12.0`.
- `pnpm check:fast` is currently failing due to pre-existing unrelated Biome/type-format issues in other files already modified in the worktree; no failures were introduced by the Node 24 standardization files.
