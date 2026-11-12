# Testing

Testing rules: test tiers and deadlines, temporary files and the pinned time zone, fixture
helpers and `fromPartial`, the React Compiler in component tests, renderer test types, and
CI-only test environment quirks.
Load when writing or debugging tests, or changing Vitest configuration.

## Vitest runs on Bun: what differs from Node

Every tier runs as `bun --bun vitest` (ADR 0064); `bun run test:node-runtime` (Unit Tests CI job) runs the unit tests of `src/main`, `src/shared` and `packages` again on Node.js 24, which they ship on. Bun 1.4.4 differs from Node in ways that break tests, not product code, and the tier configs or test helpers absorb them:

- Bun's builtin ESM named exports are fixed once the first importer loads them, and `syncBuiltinESMExports()` does nothing. Patching `os.homedir` or `net.connect` on the module object never reaches `import { homedir } from 'node:os'`. The tiers alias `node:os` to `scripts/test-support/node-os.ts` so `homedir` follows the per-file HOME. The same gap affects the trusted-main extension network guard in product code.
- `'__esModule' in namespace` is true for every ES namespace, so Vitest's external interop returns the wrong object for a package whose default export is a namespace (zod). `server.deps.inline: ['zod']` fixes it.
- A bare `undici` resolves to Bun's partial builtin (no `MockAgent`); the tiers alias it to the npm package.
- `ChildProcess` pipes and `Event.isTrusted` are accessors that cannot be assigned (`pipedChildProcess()` in `src/main/test-support/`). `fs.access` resolves `null`. `readdir` order differs. A `maxBuffer` error's `code` sits on its prototype (`errorCode()` in `@shared/utils/node-error`).
- `bun --bun` puts a directory first on `PATH` whose `node` is Bun; `nodeRuntime()` skips it.
- With no `node_modules` above it (a scratch repository under the temp directory), Bun resolves a package from its global install cache. `bunfig.toml` sets `install.auto = "disable"` so such a lookup fails as on Node.
- oxlint's RuleTester refuses Bun (it needs a 6 GiB `ArrayBuffer`), so the custom lint rule tests run through `oxc-parser` (`scripts/oxlint/__tests__/lint-rule.ts`).
- Bun's `tty.ReadStream` destroys itself on EAGAIN, so node-pty gave no output; `patches/node-pty@1.1.0.patch` polls the master with `fs.read` on Bun.

## Runtime-importing unit tests time out under heavy machine load

The unit tests that import the app runtime (`settings-*.unit.test.ts`, `runtime-usage-statistics`, `runtime-idle-cache-warming`) reset it in a `beforeEach` that can pass its 60 s hook limit when the machine is busy (load average above about 20, for example several agent Sessions building at once). `bun run verify` and the pre-push hook then fail on files the change never touched. An earlier note blamed `build/session-embedding-model/`. That was wrong: they also fail without it, and pass alone once the load drops. Rerun them alone, or rely on CI, before suspecting the change.

## `fromPartial` hides fixture mismatches as well as expressing them

`fromPartial` from `@total-typescript/shoehorn` casts. Wrapping a whole test fixture in it
makes type errors disappear whether the partiality was intended or not: a field with an
outright wrong type (`switchToLocalMode: 'not-a-function'` where `() => void` is required)
compiled silently once the object was wrapped. Verified while building the renderer test
type guard — the guard passed with the broken fixture until the wrapper was removed.

Use it only where a large type is deliberately stubbed and the test asserts on a subset.
When a fixture is *meant* to be complete, keep it unwrapped so a missing or wrong field
is reported. Two of this repository's own fixtures were failing for exactly that reason:
required fields had been added to `SessionContextRowState` and never added to the fixtures.

## The React Compiler now runs in component tests

`vitest.component.config.ts` applies `reactCompilerPreset()` via `@rolldown/plugin-babel`,
matching `electron.vite.config.ts`. Before this, component tests exercised un-compiled
output while the app shipped compiled output, so the suite was structurally blind to
compiler-interaction defects.

Proof it now bites: deleting the scoped `'use no memo'` from `FileTree.tsx` — the directive
that fixed a navigator rendering zero rows in the app while tests passed — fails 5 tests.
Before the change, removing it failed none.

The unit config runs in `environment: 'node'` and renders nothing, so it needs no compiler.

## The renderer test type exemption list is empty; keep it that way

`scripts/renderer-test-type-exemptions.json` is `[]`. Every renderer test file typechecks
under `tsconfig.renderer-tests.json`, enforced by `bun run typecheck` (the runner's `typecheck` step, also in `bun run check`
and `bun run verify`), which is binary per file: any test file with a type error fails. The
dominant fix while clearing the original 330 was annotating fixture factory return types
(`ChatTextPart`, `UIMessage`, `SessionNode`, `MessageChatRow`, `ChatPanelSections`, etc.)
so a literal like `type: 'text'` or `role: 'assistant'` is checked against the interface
instead of widening to `string`. Do NOT use `fromPartial` to silence a whole-object
mismatch — it casts and hides real errors.

## Filed under "Renderer And Session Memory"

- Interrupted E2E fixtures seed both `session_runs` and `session_active_runs` within the Session transaction. Sidebar rows can read the branch projection while exact filter counts read the canonical Run; seeding only one produces contradictory UI state.
- E2E and diagnostic code that opens the application database must use the canonical Session Host database path (`session-host/session-host.sqlite`) through the shared fixture/path helper. `userData/openwaggle.db` is only the pre-cutover source and is absent for a fresh profile.

## Filed under "Product And UX Memory"

- Native resize tests must establish their input precondition and await the renderer's responsive state, not just `BrowserWindow.setContentSize()`, which returns before ResizeObserver runs. Hidden iframe pointer delivery can miss on macOS as well as Linux/Windows: non-privileged tab tests use delegated DOM clicks while host follow-ups retain trusted keyboard activation. CI preserves Playwright reports even when retries make the job green.

## Filed under "Access Modes And Authorization Memory"

- Guard visible strings with a source scan, not `queryByText('some-id')`. Exact-match queries stay
  green when an identifier is appended to a label, which is how `pi-tui-custom` survived its own test.
  A source scan is only worth its name if it recurses and includes `.ts`: the first version walked two
  directories non-recursively with a `.tsx` filter, so it could not see nested components, other
  features, or the label maps in plain modules, and it reported green while user-facing copy named the
  runtime. Prove such a guard fails by injecting a leak before trusting it.

## Filed under "Tooling Memory"

- Tests never see the real user's home. On 2026-10-07 a dev test run migrated a maintainer's real `~/.openwaggle/mcp.json` (entries rewritten to overrides, one server dropped), because MCP migration, Pi credential/settings migrations, Pi session discovery, and the cache-warming settings fallback resolve paths from `os.homedir()` and Pi's `getAgentDir()`. `scripts/test-support/isolate-user-home.ts` is the first setup file of every Vitest config (unit, integration, component, coverage, default): it points HOME/USERPROFILE, `PI_CODING_AGENT_DIR`, and `OPENWAGGLE_USER_DATA_DIR` at a per-file temp dir, unsets `PI_CODING_AGENT_SESSION_DIR` (Pi would write every session file there) and `OPENWAGGLE_HOST_TMPDIR` (so tests run from an agent shell need no `env -u`), and fails the file, and every test (`beforeEach`), when one resolves to `os.userInfo().homedir`. It lives under `scripts/` because Biome's `noProcessEnv` covers `src/`. A test needing other locations sets its own temp dirs; never point one back at the real home, not even a symlink inside it (`isolate-user-home.ts` checks only HOME itself). Tests and harnesses that need AWS get copies or short-lived credentials: the Bedrock test gets 0400 copies of `~/.aws/config` and the SSO cache (`scripts/perf/lib/aws-sso-home.ts`), and every agent-context eval Run (YOLO, real model) gets exported role or STS session credentials in its environment and no `~/.aws` at all (`scripts/evaluate-agent-context-aws.ts`).
- Perf and eval harnesses (`scripts/perf/**`, `evaluate-agent-context*`, the benchmark's OpenWaggle row) launch the app and every `openwaggle` CLI in their own process group, so Ctrl-C reaches only the harness and Node skips `finally`. `launchApp` and `createPerfProfile` register with `scripts/perf/lib/interrupt-cleanup.ts`, whose SIGINT/SIGTERM/SIGHUP handler stops the groups, then disposes the profiles (Host included), then exits 128+signal. A new launcher that spawns detached outside `launchApp` must register there too.
- Tests leave no temporary files (#358). A beta.25 run left ~200 dirs (58 MB) in TMPDIR. `vitest-temporary-root.ts` (the `globalSetup` of every config) makes one run root, `/tmp/owvt-*` on POSIX (Unix socket paths cap at ~104 bytes; the macOS per-user temp dir would push Session Host test sockets past it), and removes it at the end of the run. `isolate-user-home.ts` gives each file `<root>/f*/` holding the isolated home, user data, and `tmp/`, which TMPDIR/TMP/TEMP point at. Its `afterAll` (first setup file, so it runs last) fails the file if `tmp/` is not empty, listing each entry with a sample of its contents, then removes the file directory. Tool caches (`jiti`, `node-compile-cache`, `tsx-<uid>`) do not count. A file whose tests are all skipped (platform-gated suites) runs no `afterAll` at all: that was the `ow-test-user-*` leak, and the run root removal covers it. `globalSetup` teardown errors do not fail a Vitest run, so the per-file hook is the guard. Common leak causes: a helper's `mkdtemp` with no teardown (use `temporaryTestDirectory()` from `src/main/test-support/`, which removes the directory in `onTestFinished`, and only works inside a test, not a hook); a test calling a setup helper twice into one variable; code under test writing into its own temp files (Pi codemode's `image()` writes `pi-codemode-*`, the trusted-main runtime's per-process `openwaggle-trusted-main-*` cache). Pi's `ModelRuntime.registerNativeProvider`/`registerProvider`/`unregisterProvider` start a refresh they do not await, and it writes `auth.json` and `models-store.json` into the agent dir after the test removed it. Await `modelRuntime.refresh({ allowNetwork: false })` after dispose (refreshes are serialized) before removing the dir, as `cleanupOpenWagglePiSessions` does.
- Tests run in one pinned zone (#358 gate). `TEST_TIME_ZONE_ENV` (`vitest-tier-options.ts`) sets `TZ=Pacific/Kiritimati` (UTC+14, no DST) in every config's `test.env`, so the machine's own `TZ` never reaches a test; `OPENWAGGLE_TEST_TIME_ZONE` replaces it, and the nightly `unit-west-of-utc` job runs the unit tier at `America/Adak` (UTC-10, DST). Chosen over a nightly-only check because the pin runs in `bun run verify` and the required Unit job at no cost, so a local-date mistake fails on the PR instead of the morning after merge, and results stop depending on whether the developer is near UTC (CI runners are UTC, which hid the usage-cost bug: `Date.UTC(2026, 9, 13, 22, 30)` is after a local-noon `NOW` at UTC+14). Node applies a runtime `process.env.TZ` change, so `vi.stubEnv('TZ', ...)` switches zone inside one test.
- Component tests keep Vitest's 10 s hook / 5 s test deadlines. A cold dynamic import of a large graph (the workspace lifecycle hook) took ~10 s at load 20 and failed the first test's `beforeEach`. Import once in `beforeAll(..., COLD_IMPORT_TIMEOUT_MS)`; `cold-import-hooks.unit.test.ts` scans the component tier for imports or `await loadX()` in `beforeEach`, and `beforeAll` imports without a deadline. Tests that re-import after `vi.resetModules()` pay the cold import each time and take the same deadline on the `it`.
- `bun run test:coverage` must use each tier's deadlines. Its projects take `NODE_TIER_TIMEOUTS`/`COMPONENT_TIER_TIMEOUTS` from `scripts/test-support/vitest-tier-options.ts`, which the tier configs also use. With none, 26 tests in 10 files hit Vitest's 5 s default on a clean main.
- Seeded QA sessions written straight to SQLite have no Pi session file. A run in one persists Pi's snapshot, which does not contain the seeded nodes and replaces them. Seed fresh fixtures for each run that sends a message, or use app-created Sessions.
- Unit, integration, and component tests belong in nearby `__tests__/`. There is no E2E suite (ADR 0033).
- A test that spawns many real child processes is an integration test (`*.integration.test.ts`), not a unit test. The protected profile-credential store runs every owned-file read/write/list/unlink in a fresh `node -e` helper, so one staging test spawns 20–300 processes. Under the full parallel unit suite on a busy Mac each spawn slowed from ~90 ms to 1–5 s, and those tests became the only recurring pre-push timeouts. Raising `testTimeout` again would not have fixed this. The eight spawn-heavy files now live in the integration tier, which CI still runs on every PR; the unit tier keeps the files that spawn only a handful of processes.
- Node 24 Vitest workers abort in better-sqlite3@12.11.1 teardown (`Statement::~Statement()` → `RemoveEnvironmentCleanupHook`). `@effect/sql-sqlite-node` pulls v12 while the app uses v13; keep the workspace override that makes Effect reuse v13.0.1. This removes the duplicate native addon and lets the full parallel unit suite finish.

## A mocked `@/shared/lib/ipc` answers like the real bridge

The renderer's `api` proxy answers every name: a member the preload lacks is a no-op subscription
(`on*`) or a rejected call, so `typeof api.x === 'function'` is always true and renderer code
calls contract members unguarded (`openwaggle/no-api-typeof-guard`). A test that mocks
the bridge with a plain partial object answers `undefined` instead and throws where the app never
does. Wrap the members: `vi.mock('@/shared/lib/ipc', async () => ({ api: (await
import('@/test-utils/preload-api')).preloadApi(apiMocks) }))`. Session resource tests that keep one
`listSessionResources` list spread `sessionResourceCatalogOver(list)` from
`features/session-summary/hooks/__tests__/session-resource-catalog.fake.ts` for the paged reads.

## Reused workers in the unit and component tiers

- The unit and component tiers run with `isolate: false` (`REUSED_WORKERS` in `scripts/test-support/vitest-tier-options.ts`). Under `isolate: true` each file paid again for Effect, Pi's SDK (about 4.9 s per standalone import) and jsdom: 60% of unit worker time was imports. `scripts/test-support/reused-worker-isolation.ts` must stay the first setup file: it resets Vitest's module graph and mock registry through `__vitest_worker__`/`__vitest_mocker__` (it throws if a Vitest upgrade moves them), restores env, cwd, timers, process listeners, globals, the builtins that the trusted-main egress guard patches, and jsdom's document and storage. It cannot reset state kept inside an external package, such as Pi's Bedrock client cache: a test that reads such state clears it first.
- Vitest stores a mocked module's mock in that module's fetched `meta` (`meta.mockedModule`). A reset that keeps the node lets one file's factory mock answer a later file that automocks the same module. The reset therefore waits (at most 2 s) for the imports the previous file left running, then drops every non-Vitest node from the three `evaluatedModules` maps. If it reset nodes in place, a late `import()` or lazy component would put its node back, evaluated against the next file's mock registry. Those CI failures did not reproduce locally, even when replaying a worker's exact file order; they show up only as timing races on the runner.
- The reset clears listeners that test or app code left on jsdom's window and document, but not those added by an external package. React marks the document and a portal's body once, and is not evaluated again, so removing its listeners broke every later portal (context menus) in that worker. It also clears pending animation frames and `process.exitCode` (Bun ignores `undefined`, so the reset sets 0).
- Leaks that only show with reuse: a lazily loaded component whose import resolves in a later file (mock it), a `FileHandle` left to the GC, a module cache in a dependency. Bisect with an order file and a sequencer that replays one worker's file order.
- The first import of `src/main/runtime` transforms the whole app: 40 s on a busy Mac, over 190 s at load 25+ (transform 140 s). A hook that does it cold needs a `beforeAll` with its own timeout, imported sequentially (not `Promise.all` of modules that import each other).
- `timeout <n> bun --bun vitest ...` kills the CLI but leaves its worker processes running at 100% CPU, orphaned to PID 1. Several of them doubled every later timing. After any killed run, find the orphans whose command contains this worktree path and kill them by exact PID.
- `scripts/coverage-uniqueness.ts` builds the nightly per-file coverage index, and the advisory `coverage-uniqueness` check step compares a branch's new test files against it. Advisory steps (`advisory: true` in `step-model.ts`) pass whatever they exit with. Their findings print after the summary locally and become job-summary notices on Actions, so the green output budget still applies. The required CI job contract is fail-closed, so the step gets its token in the separate `test-advisory.yml` workflow.

## Filed under "Electron E2E launches ignore a running dev app, but a dirty tree blocks checkouts"

`git worktree` operations can leave worktree backlinks dangling after nested git-fixture tests run; `git worktree repair <path>` from the main checkout fixes them. Git hooks export `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, so hook scripts that invoke the test suite must unset those first or git-spawning fixtures fail with "this operation must be run in a work tree".

## Filed under "Startup compatibility needs persisted-profile tests"

Linux terminal integration and E2E jobs explicitly install zsh. Shell-specific PTY tests assert the selected shell because the production fallback chain can otherwise exercise Bash while a test claims to cover zsh startup files. CI step changes also need the exact step contract and workflow AST hash updated without weakening the existing required gates.

GitHub's Linux runner completion directories can fail `compaudit`, leaving interactive zsh blocked on a trust question. Repair ownership/write permissions only on audited paths in disposable CI runners, then require a clean audit. Do not bypass the user's completion security check in production.
