# 20 — Write Project README

**Status:** Planned
**Priority:** P4
**Severity:** Strategic
**Depends on:** None
**Origin:** H-15

---

## Problem

The project has 14k of CLAUDE.md and no README.md. There is no entry point for a human to understand what this project is, how to install it, or how to run it.

## Implementation

- [ ] Create `README.md` with:
  - One-paragraph description of what OpenWaggle is
  - Screenshot or GIF of the app
  - Prerequisites (Node, pnpm, platform requirements)
  - Install + run instructions (`pnpm install && pnpm dev`)
  - Brief architecture overview (link to CLAUDE.md for details)
  - Link to tasks/specs/ for roadmap
  - License

## Files to Touch

- `README.md` (new)

## Tests

- Manual: README renders correctly on GitHub
