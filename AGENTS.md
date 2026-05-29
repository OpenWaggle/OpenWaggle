# AGENTS.md

This is the root entrypoint for agentic coding work in OpenWaggle. Keep this file short; load deeper guidance only when the task needs it.

## Start Here

1. Inspect the current working tree before editing: `git status --short --branch`.
2. Treat uncommitted work as source of truth. Another agent may be refactoring this repository; do not overwrite, revert, unstage, or "clean up" work you did not create.
3. For non-trivial work, skim `MEMORY.md` before planning. Load the sections relevant to Pi, Electron, sessions, renderer, release, or tooling when those areas are touched.
4. Load `.agents/standards.md` before architectural, TypeScript, renderer, Pi, Electron, testing, or tooling changes.
5. Load `.agents/verification.md` before deciding which checks to run.
6. Load skills from `.agents/skills/<skill-id>/SKILL.md` only when the task or user explicitly calls for that expertise.

## Commands

Use `pnpm` only.

```bash
pnpm dev                # Electron dev app
pnpm dev:debug          # Electron dev app with CDP on port 9222
pnpm build              # Production build
pnpm typecheck          # Node + web typecheck
pnpm lint               # Biome + ESLint architecture and style rules
pnpm check              # Full static verification
pnpm test               # Unit + integration + component tests
pnpm test:unit          # Unit tests
pnpm test:integration   # Integration tests
pnpm test:component     # Component tests
pnpm test:e2e           # Playwright E2E, builds first
pnpm test:coverage      # Coverage report
```

## Repository Model

OpenWaggle is an Electron desktop coding-agent UI on top of Pi.

- Main process: `src/main/`, Node/Electron, Effect services, ports, adapters, IPC, persistence.
- Preload: `src/preload/`, typed bridge from renderer to IPC.
- Renderer: `src/renderer/src/`, React 19, React Compiler, TanStack Router/Query, Zustand, Tailwind v4.
- Shared: `src/shared/`, platform-neutral types, schemas, constants, and pure utilities.
- OpenWaggle app Pi SDK imports belong under `src/main/adapters/pi/`; dedicated Pi packages may import Pi SDKs inside `packages/pi-*`.
- Provider/model/auth metadata comes from Pi through OpenWaggle ports, not a parallel OpenWaggle registry.

## Operating Rules

- Do not commit, push, reset, clean, checkout, restore, or delete branches unless the maintainer explicitly approves that exact action.
- Do not use destructive commands to resolve local conflicts. Ask if unrelated work blocks the task.
- Prefer additive or isolated changes when another agent is active.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed; durable project memory lives in `MEMORY.md`.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not create those files manually during unrelated work.
- Project-local skills are discovered from `.openwaggle/skills` and `.agents/skills`; same-name `.openwaggle` skills win at runtime.

## Standards And Verification

- Engineering standards: `.agents/standards.md`.
- Validation matrix: `.agents/verification.md`.
- Durable project memory: `MEMORY.md`.
- Architecture index: `docs/architecture.md`.
- Architecture docs: `docs/first-principles.md`, `docs/system-architecture.md`, `docs/hexagonal-architecture.md`, `docs/renderer-architecture.md`.
- Architecture decisions: `docs/adr/`.
- User-facing docs source: `website/src/content/docs/`.

## Agent skills

### Issue tracker

OpenWaggle uses GitHub Issues and the GitHub roadmap project for issue planning. See `docs/agents/issue-tracker.md`.

### Triage labels

Use Matt-style triage roles as canonical GitHub labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

OpenWaggle is a single product domain with a sectioned domain map for Pi runtime, session projection, renderer, providers, MCP, and release work. See `docs/agents/domain.md`.

### Design docs

Agent-facing product and UI guidance lives in `docs/agents/design.md`; canonical user-facing docs remain under `website/src/content/docs/`.

### Release docs

Agent-facing release and update-track guidance lives in `docs/agents/release.md`; the canonical release reference is `docs/release-and-versioning.md`.

## Definition Of Done

1. Scope is met without unapproved side effects.
2. Types, lint, architecture, and relevant tests are green or reported with exact blockers.
3. Renderer changes are checked with React Doctor when practical.
4. Renderer, preload, IPC, and interaction changes are verified in real Electron via `pnpm dev:debug` and `electron-qa` when practical.
5. Significant OpenWaggle technical findings are added to `MEMORY.md` or a focused skill, not to deleted legacy memory files.
6. The final report states what changed, what was validated, and any remaining risk.
