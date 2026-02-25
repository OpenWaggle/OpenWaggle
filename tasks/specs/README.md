# OpenWaggle Specs

North star: **Multi-agent conversation** — two LLMs collaborating on a task in real-time.

Everything else either unblocks it or strengthens it.

## How to pick what to work on

Each spec file has a `**Priority:**` field in its frontmatter. Scan the spec files directly — don't rely on this README for status. The spec file is the source of truth for its own status, priority, and progress.

Priority levels:
- **P0** — Do this first. Blocks the user right now.
- **P1** — Critical. Security or data-loss risk.
- **P2** — High. Significant bugs or high-impact features.
- **P3** — Medium. Quality-of-life improvements.
- **P4** — Low or strategic. Nice-to-have, long-term.

## Spec template

Every spec file follows this format. Use it when creating new specs.

### For a bug or fix

```markdown
# NN — Title

**Status:** Planned | In Progress | Done
**Priority:** P0 | P1 | P2 | P3 | P4
**Severity:** Critical | High | Medium | Low | Strategic
**Category:** Fix
**Depends on:** (list spec numbers, or "None")
**Origin:** (where this was identified — H-XX, Spec XX, multi-agent review, etc.)

---

## Problem

What is broken and why it matters. Be specific — include file paths, line numbers,
and exact error messages when relevant. Future agents will use this as their entry point.

## Implementation

### Phase 1: ...
- [ ] Checkable items with specific file paths and code changes

### Phase 2: ...
- [ ] ...

## Tests

- Unit: ...
- Component: ...
- Integration: ...
```

### For a feature

```markdown
# NN — Title

**Status:** Planned | In Progress | Done
**Priority:** P0 | P1 | P2 | P3 | P4
**Category:** Feature
**Depends on:** (list spec numbers, or "None")
**Origin:** (where this was identified)

---

## Problem

What capability is missing and why users need it. Include references to existing
stubs, dead-end UI, or related code. Reference other tools that solve this well.

## Architecture

How the feature fits into the existing system. Include type definitions, data flow
diagrams, storage strategy. This section helps agents understand the design before
they start coding.

## Implementation

### Phase 1: Core
- [ ] Checkable items — one per logical unit of work

### Phase 2: UI
- [ ] ...

### Phase 3: Polish (optional)
- [ ] ...

## Tests

- Unit: ...
- Component: ...
- Integration: ...
```

### Key principles

- **Be specific**: Include file paths, line numbers, and type definitions. Agents work better with concrete references than abstract descriptions.
- **Phases are incremental**: Each phase should produce a working increment. Phase 1 should be the minimum viable implementation.
- **Tests are mandatory**: Every behavior change needs corresponding test expectations.
- **Origin tracking**: Always note where the spec came from so we can trace decisions back to its source.
- **Update the spec**: When you start a spec, set Status to `In Progress`. When done, set it to `Done` and move the file to `tasks/archive/`.

## Dependency graph

```
00 (subscription auth) — P0, no deps

Bugs & Fixes (01-24):
  01-05 (critical)  — P1, no deps
  06-14 (high)      — P2, 06 benefits from provider registry
  15-18 (medium)    — P3
  19-20 (low/strat) — P4
  21 (agent loop test) — P2 (upgraded from P4, see spec for rationale)
  22-24 (low/strat) — P4

Core Features (25-35):
  25 (auto-verification)     — no deps, high impact
  26 (MCP)                   — no deps, ecosystem table-stakes
  27 (quality routing)       — benefits from 06 (executor perms)
  28 (skills)                — no deps, existing infrastructure
  29 (codebase indexing)     — no deps
  30 (browser feedback)      — no deps, Playwright in deps
  31 (codebase memory)       — evolves 29
  32 (cross-agent review)    — builds on multi-agent (done)
  33 (skill marketplace)     — extends 28 (skills)
  35 (ship to users)         — should come after critical fixes

UI & UX Features (36-45):
  36 (settings consolidation) — no deps, reduces UI debt
  37 (command palette wiring) — depends on backing features (28, 40, 41, 42)
  38 (token & cost tracking)  — no deps
  39 (context window)         — benefits from 38 (token tracking)
  40 (plan mode)              — no deps
  41 (personalization)        — no deps
  42 (git worktrees)          — benefits from 44 (git settings)
  43 (environments)           — no deps
  44 (git settings)           — no deps
  45 (archived threads)       — benefits from 39 (context window awareness)
```

## Archived

Completed specs and resolved bugs live in [`tasks/archive/`](../archive/).
