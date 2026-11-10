# Move the Toolchain and the Desktop Shell to Bun Before v1

Status: proposed

OpenWaggle's checks are slow, noisy and spread across overlapping tools: a green `pnpm check` takes 434s of serial CI time and prints about 23k tokens of output, and agents must learn Biome, ESLint, oxlint, Prettier, tsx and pnpm conventions with different suppression syntaxes. Agents do most of the work in this repository, so every second of feedback and every token of output is a recurring cost. We decided to move the repository and the desktop shell to Bun and its tools in one change, before `1.0.0`, because after `1.0.0` the shell move breaks Covered surfaces (user data location, update path, supported platform minimums) and would need a `2.0.0`.

## Decision

- **One change, before v1.** The toolchain, the stricter standards, the agent PR workflow, and the Electron-to-Electrobun shell move land together so the before and after are measured as one result. The first RC waits for it.
- **Blockers are solved, not dropped.** A gap found during the move gets an alternative (another Electrobun feature, a Bun or native replacement, an upstream fix, a library swap) with its cost and risk, rather than a fallback to Electron.
- **Bun is the package manager.** `bun install` and `bun.lock` replace pnpm. pnpm's `trustPolicy: no-downgrade` has no Bun equivalent, so a repository check compares each locked version's npm provenance with earlier versions, keeping the 30-day window and the reviewed `@pierre/*` exception from PR #145 (ADR 0016 adopted that package). The release-age delay and build-script allowlist move to Bun's settings. npm trusted publishing is unchanged.
- **Vitest stays, on the Bun runtime.** Every test tier runs through `bun --bun vitest`, so main-process tests exercise the runtime that ships. `bun test` was not adopted for now: the suite's 2,170 `vi.mock` and 887 `vi.hoisted` calls would need rewriting.
- **Tools are chosen by measurement.** Bundler, type checker, linter and formatter are picked from CI medians (at least 5 runs; a difference within run-to-run spread is a tie). The measures, in order: the agent feedback loop (changed-file verdict under 5s, then the full gate); output tokens (one line when green, only `file:line:col rule message` lines on failure, with a CI ratchet like the first-turn prefix budget); fewer tools and rules to learn; no regression in app start, memory or install size; then CI and build time; then simplicity.
- **The strictest practical standard.** Every strict TypeScript flag that the code can be brought to, type-aware linting with the project's custom rules and no inline suppressions, and Fallow and React Doctor as required gates that agents run and fix.
- **Git hooks, not PR hooks.** Hooks format staged files, check commit messages, and run a fast verify on push. Force pushes are blocked without a prompt, and agent guardrails block skipping hooks. Opening or readying a PR is not gated.
- **Formatting keeps the current style** (single quotes, no semicolons, width 100).
- **Linting uses a pinned Bun canary.** `bun lint` exists only in canary builds. A dated canary at least 7 days old is pinned for linting alone, on two conditions measured in CI: it is faster than oxlint on the same config, and it is stable (findings identical across runs, across Linux, macOS and Windows, and to oxlint's, with no crashes or hangs). The runtime, installer and test runtime stay on stable Bun. The config stays in oxlint format, so moving to a stable `bun lint` or back to oxlint is a one-line change.
- **Project memory is loaded by topic.** `MEMORY.md` (549 KB, about 137k tokens, which agents were told to skim before non-trivial work) becomes a short index over topic files under `.agents/memory/`, each opening with a summary, and repository standards cap their size.

## Consequences

- `AGENTS.md`, `.agents/standards.md`, `.agents/verification.md` and the "pnpm only" rule change to Bun; `pnpm-lock.yaml` and `pnpm-workspace.yaml` go away.
- The release workflow, updater, signing and supported-platform documentation must cover the Electrobun build before the first RC, including updating existing Electron installs and moving their user data.
- Replaces the pnpm-specific supply-chain settings in `pnpm-workspace.yaml` once the provenance check lands.
