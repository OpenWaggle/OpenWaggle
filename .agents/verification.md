# OpenWaggle Verification Matrix

Run the narrowest meaningful checks first, then broaden before handoff.

## The check runner

`check`, `verify`, `lint`, `check:fast`, `check:changed` and `typecheck` all run `scripts/check/run.ts`, which runs the step graph declared in `scripts/check/steps.ts` in parallel. A green run prints one line; a failed step prints its `file:line:col` findings, a `fix:` hint and its log. Every step's full output is in `.tmp/check/<step>.log` and the timings are in `.tmp/check/report.json`.

```bash
bun run check:changed                        # format, lint, standards on files changed vs origin/main
bun scripts/check/run.ts --only lint,typecheck   # chosen steps and their dependencies
bun scripts/check/run.ts --list              # the check gate's steps (verify --list for verify)
```

Run `bun run check:changed` after each edit (a few seconds), then `bun run verify` before pushing. Package builds are cached in `.tmp/check/cache.json` by their inputs; `--no-cache` rebuilds them. `CHECK_CONCURRENCY` or `--concurrency n` caps parallel steps (default: half the cores); cap it when the machine is busy.

## Pre-Push Baseline

```bash
bun run verify
```

`bun run verify` is the fast, deterministic pre-push contract: conventional-commit policy against the `origin/main` merge base, typecheck, format, lint, repository standards, and unit tests. The husky pre-push hook runs it for every feature-branch push. Run it before pushing rather than discovering these failures from a red CI run.

## Git Hooks And Agent Guardrails

Husky runs three hooks (`.husky/`, logic in `scripts/git-hooks/`):

- `pre-commit` formats the staged files with oxfmt and restages them. A file that also has unstaged changes is left alone and named.
- `commit-msg` rejects a subject that is not a Conventional Commit (`scripts/check-conventional-commits.ts --message-file`).
- `pre-push` refuses a push that drops commits from a remote ref, with no prompt or override, then runs `bun run verify` (`prepush:main` for a push to `main`). Opening or readying a PR is not gated.

The project Pi extension `.pi/extensions/git-guardrails.ts` (`scripts/agent-guardrails/`) blocks agents, without a prompt, from skipping the hooks (`--no-verify`, `git commit -n`, `HUSKY=0`, `core.hooksPath` changes by `git config`, `git -c` or `GIT_CONFIG_*`, editing `.git/config` or `.husky/_`, removing or emptying a hook script) and from force pushing. It reads compound commands, wrappers, nested shells and here-documents; a script piped into a shell is blocked because it cannot be read. When a hook fails, fix what it reports; if the cause is outside the task, stop and report it.

## Fallow And React Doctor

```bash
bun run check:fallow        # fallow dead-code + dupes, fails on any finding
bun run check:react-doctor  # react-doctor, fails on warnings and errors
```

Both are required steps of `check` (the CI Typecheck & Lint job). Fix findings in code. A verified false positive gets a `.fallowrc.jsonc` or `doctor.config.ts` entry scoped to the file and rule, with a comment giving the reason; never a `fallow-ignore` or other suppression comment. `fallow health` is advisory.

## No-Cheating Check

```bash
bun run check:no-cheating                    # against the merge base with origin/main
bun scripts/check-no-cheating.ts --base <ref>
```

The `no-cheating` step of `check` and `verify` (so CI and pre-push) compares the working tree, committed or not, with the merge base with `origin/main` and fails a change that checks less. It never prompts, prints nothing when clean, and prints one `file:line [no-cheating/<kind>] message` line per finding (`scripts/no-cheating/`). The "No cheating" section of `.agents/standards.md` lists the kinds. Moving files to a stricter project, a new reference, a stricter `extends` and excluded build outputs pass the tsconfig comparison (`scripts/tsconfig-strictness/`). The route tree and `bun.lock` are not checked as generated files: every renderer build rewrites the route tree, and Bun cannot compare a lockfile with a fresh resolution offline.

In CI a missing `origin/main` fails the step instead of comparing with `HEAD`; the Typecheck & Lint job checks out with `fetch-depth: 0`. Measured at load average 11 to 15 on 14 cores against a merge base 2,114 files back: 1.0 to 1.6 s for the step (0.3 s with nothing changed). The tsconfig comparison parses every reachable project twice through TypeScript 7's config API and caches each side by config and file-list hash in `node_modules/.cache/openwaggle/`, and runs only when a tsconfig changed.

## CI Gate Tiers

CI is not tiered behind a merge queue (ADR 0033 refines ADR 0029). Pull requests and pushes to `main` run the same gate; there is no desktop E2E and no merge queue:

- **Per-PR / per-push gate:** Commit Policy, Typecheck & Lint, Unit Tests, Integration & Component Tests, MCP Conformance, plus the always-present Package Release Gate that aggregates them.
- **Session Performance workflow (manual/dispatch):** `bun run benchmark:session-release` validates the packaged embedding model's warm query latency and multilingual recall, the exact 100,000-Session vector index, and the 100,000-Session/10,000,000-message reference corpus. `bun run benchmark:session-performance` remains the faster local 1,000,000-message development check.
- **Nightly canary (non-gating):** `.github/workflows/nightly.yml` packages the Electrobun app and runs `packaged-app:smoke` on macOS/Linux/Windows, installs, launches and updates a package on each, and runs the syntax performance benchmark on macOS. It never blocks a merge.

Pushes to `main` run the same checks as a PR (the path-scoped `changes` job is skipped on push, which the gate tolerates).

### Windows native diagnostics

Terminals run on ConPTY through `bun:ffi` (`src/main/adapters/terminal/bun-pty/`). The manual
`windows-terminal-diagnostics.yml` workflow accepts an exact `head_sha` and runs the terminal
backend integration tests on a Windows runner, retaining their log. It keeps ConPTY
investigations apart from ordinary PR feedback, as T3 Code separates its Windows tests
(commit `b1e223e2b0d87124883b1410ab52dd6a1338e40d`, `.github/workflows/windows-tests.yml`):
OpenWaggle runs no desktop E2E in CI (ADR 0033), relying on unit + integration + MCP conformance.

## Baseline Static Checks

```bash
bun run typecheck
bun run lint
bun run check
```

`bun run check` runs typecheck plus the full static verification (installer script, contrast, Pi runtime alignment, the provenance downgrade check, format, lint, renderer bundle budget, package release validation, API snapshots, package docs, package smoke). The renderer bundle budget (`bun run check:renderer-bundle`) runs `electron-vite build`, `scripts/check-syntax-bundle.ts`, `bun run check:main-bundle`, and `bun run check:renderer-csp` (the built page's inline script against its CSP hash), so an oversized initial renderer graph fails the required Typecheck & Lint job on the PR instead of failing the release build after the version PR merges. Typecheck is one pass over the node, web and renderer-test projects with the renderer-test exemption ratchet (`scripts/check/typecheck.ts`): `bun check -b` locally and in CI (tsc only emits declarations). Lint runs the oxfmt format check, the type-aware lint config (`oxlint.config.mts`) through a pinned Bun canary `bun lint` (`scripts/lint.ts`; `bun run lint:oxlint` runs the same config through oxlint), and the repository-standards and instruction-reference checks. Each prints one `file:line:col rule message` line per finding. CI runs the check gate through `scripts/check/output-budget.ts`, which fails a green run that prints more o200k tokens than `scripts/check/output-budget.json` allows, and publishes the step times to the job summary. `bun run check:react-compiler` (part of `bun run check`) recompiles `features/chat` and `features/composer` with the React Compiler the build uses and fails on any function it leaves uncompiled; the build itself never fails on one (`panicThreshold: 'none'`).

`bun run check:dependency-pins` fails a new or changed pin behind npm's `latest` that has no `DEPENDENCIES.md` line, and a line whose pin no manifest uses.

`bun run check:provenance` reads npm registry metadata for every package in `bun.lock`. Its answers are cached under `node_modules/.cache/openwaggle`, so only the first run, or a run after a lockfile change, needs the network.

## Targeted Tests

```bash
bun run test:unit
bun run test:integration
bun run test:component
bun run test
bun run test:coverage
```

Use targeted Vitest file runs while iterating, then run the relevant script before handoff.

The test scripts run Vitest on the Bun runtime (`bun --bun vitest`, ADR 0064), so a targeted run is `bun --bun vitest run -c vitest.unit.config.ts <file>`. A plain `vitest` runs the same tests on Node, which is not what the tiers run. `.agents/memory/testing.md` lists the Bun differences the tier configs absorb.

The main process, preload, `src/shared` and the packages ship on Electron's Node.js, and the trusted main network guard and the `fs` and `child_process` paths behave differently there than on Bun. `bun run test:node-runtime` runs their unit tests (`src/main`, `src/preload`, `src/shared`, `packages`) on Node.js 24 through `node node_modules/vitest/vitest.mjs`, with the same unit config, plus the `scripts/__tests__` tests of every script a workflow runs under plain `node` (`scripts/node-runtime-tests.ts` reads them from the workflows). The Unit Tests CI job runs it after `bun run test:unit` as `bun run test:node-runtime:raw`, since `test:unit` already built the native modules for Node. `bun run test:node-runtime:integration:raw` does the same for the `src/main` integration tests and those scripts' integration tests (child processes, SQLite, node-pty, worker threads, files); the Integration & Component Tests job runs it after `bun run test:integration && bun run test:component`. Run the first after changing `src/main/extensions/`, process spawning or file handling, and the second after changing the main process's use of child processes, SQLite, node-pty or worker threads. Locally the Node integration set (1,227 tests in 309 files) took 9.5 minutes with `--maxWorkers=4`, and 19.6 minutes at a load average over 10; on the CI runner, main's Node integration and component run took about 12 minutes.

Every Vitest config runs its tests in `Pacific/Kiritimati` (UTC+14), whatever the machine's zone, so a test that confuses local and UTC days fails everywhere, not only far from UTC. The nightly workflow runs the unit tier again in `America/Adak`; reproduce it with `OPENWAGGLE_TEST_TIME_ZONE=America/Adak bun run test:unit` (a plain `TZ=...` no longer reaches the tests). Build test dates from local parts (`new Date(2026, 9, 14, 0, 30)`) when a test means a local time, and stub `TZ` in the test when it needs one zone.

Component hooks keep Vitest's 10 s deadline. Import a large module graph once in a `beforeAll` with `COLD_IMPORT_TIMEOUT_MS` (`src/renderer/src/test-utils/cold-import.ts`), never in a `beforeEach`; `scripts/test-support/cold-import-hooks.ts` fails the unit tier otherwise.

The unit tier runs in the pre-push hook next to about 1,500 other files, so keep it in-process. A test that spawns many real child processes belongs in `*.integration.test.ts`. Examples are real `git` repositories and the profile-credential owned-file helper. Process start-up under parallel load makes such tests time out in `bun run verify` even though they pass alone.

## Renderer Work

For any `src/renderer/` change:

```bash
bun run lint
bun run test:component
bun run check:react-doctor
```

React Doctor fails on warnings as well as errors; see Fallow And React Doctor above.

## Desktop / IPC / Preload Work

For renderer interaction, preload, IPC, or main-process behavior that affects the UI:

```bash
bun run dev:debug
```

It starts an Electrobun dev build of the checkout hidden, with the main window rendered by CEF and its DevTools endpoint on `http://127.0.0.1:9223` (`scripts/electrobun/dev.ts`). Then load `.agents/skills/electron-qa/SKILL.md` and verify through the real app on CDP port 9223:

- app page is reachable
- `window.api` exists
- target interaction works
- screenshot or DOM snapshot confirms behavior
- console errors are checked

## Pi Runtime Work

For Pi adapter, provider/auth/model, MCP, resource loading, session projection, compaction, active-run, or tool-event changes:

```bash
bun run test:unit
bun run test:integration
bun run check
```

Also load `.agents/skills/pi-integration/SKILL.md` and run targeted tests around the touched adapter/projection/service.

## Native / Packaged App Work

For native modules or packaged-only regressions:

```bash
bun run prepare:native:node
bun run package:app                # build, then scripts/electrobun/package.ts for this platform
```

Packaged regressions require packaged-app QA, not only dev-mode validation.

## Packaged app validation

There is no desktop E2E suite (ADR 0033). Per-PR gating relies on unit + integration + component + MCP conformance. For the real packaged app:

```bash
bun run package:app                # production bundle, packaged with Electrobun
bun scripts/check-native-platform-floor.ts   # the supported-platform floor of the packaged app
bun run packaged-app:smoke         # app directory shape + native (sqlite, sharp) load probe
```

The nightly canary (`.github/workflows/nightly.yml`) packages and smokes the app on macOS/Linux/Windows, then installs, launches and updates a package on each (`electrobun-package.yml`), as a non-gating signal. For UI-visible behavior use `bun run dev:debug` with `.agents/skills/electron-qa/SKILL.md`. Renderer boot, CSP, visual pixels, and timing budgets are no longer checked in CI — validate them locally/manually when the change touches them.
## Release Work

For publishable package work, `bun run check` should include package import-boundary checks and package API snapshot checks. Snapshot drift must be fixed by either correcting the public API change or intentionally updating the committed package API snapshot in the same PR.

Load `.agents/skills/release/SKILL.md` before release/version/update-track work.

Before publishing a release, verify from the exact CI artifacts whenever possible. Post-publish installer checks are too late to prevent shipping broken installers.
