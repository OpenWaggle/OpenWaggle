# AGENTS.md

This is the root entrypoint for agentic coding work in OpenWaggle. Keep this file short; load deeper guidance only when the task needs it.

## Start Here

1. Inspect the current working tree before editing: `git status --short --branch`.
2. Treat uncommitted work as source of truth. Another agent may be refactoring this repository; do not overwrite, revert, unstage, or "clean up" work you did not create.
3. For non-trivial work, read the `MEMORY.md` index before planning, then load only the `.agents/memory/<topic>.md` files whose trigger matches the area you touch (Pi, Session Host, renderer, release, tooling, and so on). Do not load every topic.
4. Load `.agents/standards.md` before architectural, TypeScript, renderer, Pi, desktop shell, testing, or tooling changes.
5. Load `.agents/verification.md` before deciding which checks to run.
6. Load skills from `.agents/skills/<skill-id>/SKILL.md` only when the task or user explicitly calls for that expertise.
7. For pattern matching, exhaustive union handling, runtime guards, or boundary assertions, prefer `@diegogbrisa/ts-match` when it improves clarity or type safety. Load `.agents/skills/ts-match/SKILL.md` before implementing those patterns.

## Commands

Use `bun` only: `bun install`, `bun run <script>`, `bun run --filter <package> <script>`, and `bunx <bin>`. Repository scripts run with `bun scripts/<name>.ts`, and every Vitest tier runs on the Bun runtime (`bun --bun vitest`). Node.js still runs native module builds and the MCP conformance client, so keep Node 24 installed.

```bash
bun install              # Install from bun.lock (Bun version: packageManager / .bun-version)
bun run dev              # Electrobun dev app (build, stage, `electrobun dev`)
bun run dev:debug        # Hidden Electrobun dev app, CEF renderer with CDP on port 9223
bun run build            # Production build
bun run typecheck        # One bun check -b over node, web and renderer tests
bun run lint             # oxfmt check + type-aware `bun lint` (oxlint.config.mts) + repository standards
bun run lint:fix         # Format with oxfmt and apply lint fixes
bun run lint:oxlint      # Same lint config through oxlint, the fallback runner
bun run format           # Format with oxfmt (.oxfmtrc.json)
bun run check:changed    # Format, lint and standards on files changed vs origin/main: run after each edit
bun run check:no-cheating # Fails a change since origin/main that checks less (suppressions, tsconfig, budgets, skipped tests)
bun run check            # Full static verification
bun run verify           # Pre-push verification: commit policy, typecheck, lint, unit tests
bun run test             # Unit + integration + component tests
bun run test:unit        # Unit tests
bun run test:integration # Integration tests
bun run test:component   # Component tests
bun run test:coverage    # Coverage report
```

`check`, `verify`, `lint`, `typecheck` and `check:changed` run `scripts/check/run.ts` (steps in `scripts/check/steps.ts`): parallel steps, one line when green, `file:line:col` findings plus a `fix:` hint when not, full logs in `.tmp/check/<step>.log`. `bun scripts/check/run.ts --list` shows the steps; `--only <ids>` runs some.

## CI Gates

CI runs on pull requests and, after ADR 0033, without a merge queue: once the required per-PR checks pass (Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, Package Release Gate), a PR merges directly. There is no Electron E2E suite — it was removed and per-PR gating relies on unit + integration + MCP conformance (mirroring `pingdotgg/t3code`); a non-gating nightly cross-OS packaged canary (`.github/workflows/nightly.yml`) builds and smokes the app on macOS/Linux/Windows. The npm-package supply-chain provenance attestation (`package-release.yml` + the fail-closed guards enforced by `bun run check`) and the human-approved app-release flow in `release.yml` are unchanged. Git hooks: `pre-commit` formats staged files with oxfmt, `commit-msg` checks the Conventional Commit subject, and `pre-push` refuses force pushes, then runs `bun run verify` (the full gate for `main`) — run it before pushing instead of discovering deterministic failures from a red CI run. Never skip the hooks or force push; `.pi/extensions/git-guardrails.ts` blocks both.

## Repository Model

OpenWaggle is an Electrobun desktop coding-agent UI on top of Pi (ADR 0064).

- Main process: `src/main/`, Bun/Electrobun, Effect services, ports, adapters, IPC, persistence.
- Preload: `src/preload/`, typed bridge from renderer to IPC.
- Renderer: `src/renderer/src/`, React 19, React Compiler, TanStack Router/Query, Zustand, Tailwind v4.
- Shared: `src/shared/`, platform-neutral types, schemas, constants, and pure utilities.
- OpenWaggle app Pi SDK imports belong under `src/main/adapters/pi/`; dedicated Pi packages may import Pi SDKs inside `packages/pi-*`.
- Provider/model/auth metadata comes from Pi through OpenWaggle ports, not a parallel OpenWaggle registry.

## Operating Rules

- Do not use the global `herdr-orchestration` skill in this repository. OpenWaggle Hive QA must
  create and coordinate Workers through the native `hive` tool and Session Host so tests exercise
  the product path rather than an external orchestrator.
- For Hive work, use the native `hive` tool to spawn durable Worker Sessions, then wait, read,
  and review their results. A Worker has its own transcript and may use the same checkout or a
  separate worktree; choose the Workspace deliberately. Discover optional Agent definitions
  instead of assuming named roles exist. Use `report` for peer context, `follow_up` for a later
  Run, and `steer` only for the exact active Run. See the
  [Hive guide](website/src/content/docs/using-openwaggle/hives-and-sessions.md) and
  [agent domain map](docs/agents/domain.md).
- Whenever a product, architecture, release, or process decision is needed, run the `grill-with-docs` skill (`.agents/skills/grill-with-docs/SKILL.md`) instead of deciding unilaterally or asking an ad-hoc list of questions.
- Do not commit, push, reset, clean, checkout, restore, or delete branches unless the maintainer explicitly approves that exact action.
- PR workflow: `/pr` opens a draft, `/ready` gets an independent review and marks it ready, and `/babysit` runs as soon as a PR leaves draft (`.agents/skills/{pr,ready,babysit}`). Invoking one approves the commits and pushes it makes on the current branch; never merge.
- Do not use destructive commands to resolve local conflicts. Ask if unrelated work blocks the task.
- Prefer additive or isolated changes when another agent is active.
- Add, remove or upgrade a dependency only with the maintainer's approval; a held pin gets its line in `DEPENDENCIES.md`.
- A change that makes an ADR, doc, memory topic or skill wrong updates it in the same change.
- After changing source, run the tests that cover it before the turn ends and leave them passing.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed; durable project memory lives in `.agents/memory/<topic>.md`, indexed by `MEMORY.md`.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not create those files manually during unrelated work.
- Before adding or editing anything under `website/src/content/docs/` (pages, screenshots, alt text, tables), load `.agents/skills/write-docs/SKILL.md`. User docs follow the guide, reference and overview split in ADR 0061.
- Project-local skills are discovered from `.openwaggle/skills` and `.agents/skills`; same-name `.openwaggle` skills win at runtime.

## Standards And Verification

- Engineering standards: `.agents/standards.md`. Each rule is a public lint rule or cites its OpenWaggle source.
- Held and behind-latest dependency pins: `DEPENDENCIES.md`.
- Validation matrix: `.agents/verification.md`.
- Durable project memory: `MEMORY.md` (index) and `.agents/memory/` (topic files).
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
3. Fallow (`bun run check:fallow`) and React Doctor (`bun run check:react-doctor`) report zero findings; both are required steps of `check` and CI. Fix findings in code; a false positive gets a `.fallowrc.jsonc` or `doctor.config.ts` entry with its reason, never a suppression comment.
4. Renderer, preload, IPC, and interaction changes are verified through non-disruptive real-app QA via `bun run dev:debug` and `electron-qa` when practical. Every completed agent-run desktop QA captures representative screenshots outside the repository and renders them in the final report. Never run headed desktop QA without the maintainer's explicit approval for that exact run.
5. Significant OpenWaggle technical findings are added to the matching `.agents/memory/<topic>.md` file (a new topic gets one line in the `MEMORY.md` index) or a focused skill, not to deleted legacy memory files.
6. The final report states what changed, what was validated, and any remaining risk.
