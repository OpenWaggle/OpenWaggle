# Move the Toolchain to Bun and Put the Desktop Shell Behind Ports Before v1

Status: accepted for the toolchain, the standards and the desktop shell ports. The Electrobun shell move is deferred to a follow-up (see "Deferred to a follow-up").

OpenWaggle's checks are slow, noisy and spread across overlapping tools: a green `pnpm check` takes 434s of serial CI time and prints about 23k tokens of output, and agents must learn Biome, ESLint, oxlint, Prettier, tsx and pnpm conventions with different suppression syntaxes. Agents do most of the work in this repository, so every second of feedback and every token of output is a recurring cost. We decided to move the repository to Bun and its tools before `1.0.0` and to put the Electron desktop shell behind ports. Moving the shell itself to Electrobun is deferred: after `1.0.0` it would break Covered surfaces (user data location, update path, supported platform minimums) and need a `2.0.0`, so a separate decision says whether it ships before then.

## Decision

- **One change, before v1.** The toolchain, the stricter standards and the agent PR workflow land together so the before and after are measured as one result. The app stays on Electron.
- **Electron sits behind ports.** Main-process code reaches the shell only through OpenWaggle ports (windows, menus, dialogs, paths, secure storage, protocols, updater, system integration), called through bindings in `src/main/desktop-shell/`. Only `src/main/adapters/electron/` and the preload transport import Electron packages, and every port has a contract suite its adapter passes. This keeps the shell replaceable without deciding to replace it.
- **Bun is the package manager.** `bun install` and `bun.lock` replace pnpm. pnpm's `trustPolicy: no-downgrade` has no Bun equivalent, so a repository check compares each locked version's npm provenance with earlier versions, keeping the 30-day window and the reviewed `@pierre/*` exception from PR #145 (ADR 0016 adopted that package). The release-age delay and build-script allowlist move to Bun's settings. npm trusted publishing is unchanged.
- **Vitest stays, on the Bun runtime.** Every test tier runs through `bun --bun vitest` (see the measured unit suite time below); the main process still ships on Electron's Node, so a Bun-only difference is absorbed in test setup, not product code. `bun test` was not adopted for now: the suite's 2,170 `vi.mock` and 887 `vi.hoisted` calls would need rewriting.
- **Tools are chosen by measurement.** Bundler, type checker, linter and formatter are picked from CI medians (at least 5 runs; a difference within run-to-run spread is a tie). The measures, in order: the agent feedback loop (changed-file verdict under 5s, then the full gate); output tokens (one line when green, only `file:line:col rule message` lines on failure, with a CI ratchet like the first-turn prefix budget); fewer tools and rules to learn; no regression in app start, memory or install size; then CI and build time; then simplicity.
- **The strictest practical standard.** Every strict TypeScript flag that the code can be brought to, type-aware linting with the project's custom rules and no inline suppressions, and Fallow and React Doctor as required gates that agents run and fix.
- **Git hooks, not PR hooks.** Hooks format staged files, check commit messages, and run a fast verify on push. Force pushes are blocked without a prompt, except a lease push that replays an agent's own `ow/*` PR branch (see the git-guardrails skill), and agent guardrails block skipping hooks. Opening or readying a PR is not gated.
- **Formatting keeps the current style** (single quotes, no semicolons, width 100).
- **Linting uses a pinned Bun canary.** `bun lint` exists only in canary builds. A dated canary at least 7 days old is pinned for linting alone, on two conditions measured in CI: it is faster than oxlint on the same config, and it is stable (findings identical across runs, across Linux, macOS and Windows, and to oxlint's, with no crashes or hangs). The runtime, installer and test runtime stay on stable Bun. The config stays in oxlint format, so moving to a stable `bun lint` or back to oxlint is a one-line change.
- **Project memory is loaded by topic.** `MEMORY.md` (549 KB, about 137k tokens, which agents were told to skim before non-trivial work) becomes a short index over topic files under `.agents/memory/`, each opening with a summary, and repository standards cap their size.

### Measured choices

Medians of 5 runs on GitHub's 4-vCPU Ubuntu runners, comparing rows from the same job:

- **Type checking uses `bun check`.** A cold check of every project took 9.1s, against 45.0s for `tsc -b --force` (macOS: 6.8s against 200s), with identical diagnostics. `tsc` remains only where declaration files are emitted.
- **Linting uses `bun lint`.** It was 2 to 3.3 times faster than oxlint on the same config (7.4s against 25.9s on the current config). Findings were identical across runs, across Linux, macOS and Windows, and across two canaries a week apart. It never crashed; oxlint crashed once.
- **Formatting uses oxfmt.** It took 0.54s, against 2.42s for Biome. `bun fmt` took 0.38s, but it is canary-only and the difference is negligible.
- **The renderer stays on Vite.** A `bun build` renderer took 17.9s against Vite's 23.8s, but its JavaScript was 31% larger, and 16.4s of its time was the React Compiler's Babel pass, which both builds need.
- **The main process stays on electron-vite while the shell is Electron.** `bun build` built it in 0.92s against about 6s, but it loses Rolldown's lazy module initializers and leaves `import.meta` in CommonJS output. Both are fixed by emitting ESM for a Bun target, so it moves only with the shell.
- **The `"*": ["./*"]` paths entry is removed.** It resolved nothing. Its only effect was hiding one declaration-emit error, which an explicit return type fixes.
- **Vitest runs on the Bun runtime.** The unit suite took 502s against 769s on Node, once the Bun-specific failures (zod interop, home directory, read-only `node:` builtins, undici's `MockAgent`) are fixed.

### Deferred to a follow-up

The Electron-to-Electrobun shell move is not part of this change. A spike ran the real renderer on Electrobun 2.0.6 on macOS, Windows and Ubuntu 24.04 and 22.04: the download was 41–59 MB instead of 247–272 MB, idle memory was roughly halved, and macOS packaging took 42–54s instead of 145–169s, but 7 of the 25 Electron surfaces OpenWaggle uses have no Electrobun equivalent and 10 more need workarounds. The shell design (loopback origins per trust domain, a typed RPC preload transport, `Bun.spawn` terminals, secrets in the OS keychain, transition artifacts in electron-updater's format, a patched native layer for macOS 13.4 and glibc 2.35, native helpers for the missing APIs), its first-launch migrator, and its CI floor checks are kept on a separate branch. They ship only if a later decision says so, and that decision amends this ADR.

## Consequences

- `AGENTS.md`, `.agents/standards.md`, `.agents/verification.md` and the "pnpm only" rule change to Bun; `pnpm-lock.yaml` and `pnpm-workspace.yaml` go away.
- Replaces the pnpm-specific supply-chain settings in `pnpm-workspace.yaml` once the provenance check lands.
