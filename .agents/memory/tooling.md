# Tooling

Build and static tooling: the oxfmt and `bun lint` toolchain, TypeScript posture, dependency
update traps, repository-standards checks, Effect Schema traps, and package-manager notes.
Load when touching lint or format config, `tsconfig*`, `package.json` dependencies or
`scripts/check-*`.

## Tooling Memory

- Package manager: Bun (`bun install`, `bun.lock`, `bun run`; ADR 0064). pnpm was used until then.
- Package scripts run on Windows too (#446). Bun runs them with its own shell there, which takes a `NAME=value` prefix but has no `env`, so `env -u ELECTRON_RUN_AS_NODE …` fails there. Under pnpm, cmd.exe had neither: `pnpm dev` failed there from ec507e7be, which added the `ELECTRON_ENABLE_LOGGING=1` prefix (`env -u ELECTRON_RUN_AS_NODE` followed in 3eabf466a), `cli:dev` from #181, and `dev:debug:headed` from when it was added, until #447. `scripts/run-electron-dev.ts <vite|electron>` starts electron-vite's entry script on Node (`nodeRuntime()`, since the script itself runs on Bun) or Electron on the project, drops `ELECTRON_RUN_AS_NODE` under any casing on Windows, and forwards signals. `run-electron-dev.unit.test.ts` fails any root script with a command that starts with `env`. `start-electron-qa.ts` and `measure-main-startup.ts` use the same invocation. The electron-automation standard treats `electronDevInvocation(`, any reference to `run-electron-dev`, `'bun'` or `bunExecutable()` called with `dev`, `run dev` or `dev:debug[:headed]` in its argument list, `'bun'`, `bunExecutable()` or `npm_execpath` as the argument right before one, such a list built first (only the script, or the script then a `--` switch) in a file that names `'bun'` or `bunExecutable`, and a `bun run dev` or `bun dev` command string passed to exec or spawn, as starting the dev app, so only its listed owners may do it. The Bun checks skip `src/`, where project actions run a project's own `bun dev` or `pnpm dev`. On Windows the launcher forwards only SIGINT and SIGTERM (libuv cannot send SIGHUP there). The nightly canary runs `bun run qa:dev-app-startup` (`scripts/qa/dev-app-startup-smoke.ts`) on every OS. It runs `bun run dev` on a throwaway profile and HOME, waits for the Host's own database so the CLI cannot be the one starting a Host, then checks that the Host answers `hive list`. It drops inherited `OPENWAGGLE_*`/`PI_*` variables, because an agent shell's markers make the CLI refuse to run.
- Building from source on Windows needs Build Tools for Visual Studio 2022 with the Desktop development with C++ workload and the Spectre-mitigated MSVC v143 libs (node-pty fails with MSB8040 without them), plus Python 3, because the native rebuild sets `npm_config_build_from_source` (node-pty is patched). The #446 reporter's first `pnpm install` timed out on the large tarballs (onnxruntime-node and onnxruntime-web are over 100 MB unpacked), so #447 raised pnpm's `fetchTimeout` to 10 minutes. Bun has no per-download timeout to raise: `bun install` retries a failed request (`BUN_CONFIG_HTTP_RETRY_COUNT`, default 5), and the CI install action keeps its own three-attempt loop. The docs give `bun install --network-concurrency 3` for slow links.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- Strictness flags beyond `strict` live in `tsconfig.strict.json`. The renderer (`tsconfig.web.json`, `tsconfig.renderer-tests.json`), `tsconfig.shared.json` (src/shared plus the extension-sdk and waggle-core sources) and `tsconfig.website.json` extend it, and `bun check -b` checks them all through `tsconfig.json`'s references. `tsconfig.node.json` does not extend it yet; the config's comment lists the error count per flag still open there. Under `exactOptionalPropertyTypes`, `Schema.optional` decodes to `T | undefined`: widen the type, or use `Schema.optionalWith(s, { exact: true })` when the SDK type is exact (that rejects a key sent as undefined). Test fixtures that need a property absent use `omitKey` from `@/test-utils/omit-key`, and `required()` from `@/test-utils/required` replaces non-null assertions.
- Do not suppress Fallow complexity findings; refactor instead.
- Fallow cannot see exports read through `vi.mock(path, async (importOriginal) => ({ ...actual }))` (for example `actual.heldEdit`), and `tsconfig.web.json` excludes `*.test.ts(x)`, so removing such an "unused" re-export passes typecheck and dead-code but fails the component tests. After removing unused exports or barrel entries, run the full component and unit suites, not only typecheck. Exports loaded by URL `import()` (the package-release scripts) are invisible to Fallow too; they are listed in `.fallowrc.jsonc` `ignoreExports`.
- Dependency-update trap: `packages/*/dist` is gitignored but consumed by root typecheck. A stale dist built mid-bisection caused 185 phantom type errors (`AnyNoContext`/`TypeId` mismatches that looked like effect/typebox breakage). After changing any dependency version, run `bun run build:package-dependencies` before trusting typecheck results.
- Root `undici` is 8.x. `secure-fetch.ts` must wrap each DNS-pinned `Agent` in Undici's `Dispatcher1Wrapper` before passing it to Node's **global** fetch, whose bundled Undici uses the legacy dispatcher protocol. Keep `allowH2: false` on those Agents to preserve HTTP/1.1 behavior. The `@earendil-works/pi-coding-agent>undici` override remains independent.
- TanStack internal overrides (`@tanstack/history`, `router-core`, `router-generator`, `router-utils`) must move in lockstep with `@tanstack/react-router`; a pinned older `router-core` breaks at runtime with `SyntaxError: ... does not provide an export named 'getUrlScheme'` in unit suites, not at typecheck time.
- TanStack Query ≥5.102: `queryClient.query()` applies `select`, while the deprecated `fetchQuery` did not — a mechanical `fetchQuery`→`query` migration changes what test assertions receive (selected vs raw queryFn data).

## A count-based ratchet is defeated by swapping one error for another

The first version of `scripts/check-renderer-test-types.ts` compared per-file error counts
against a baseline. A deliberately broken mock in a file that already had errors kept the
total identical and passed. The check is binary per file instead: files not on
`scripts/renderer-test-type-exemptions.json` must have zero errors, and an exempt file
that becomes clean fails as a stale exemption so the list can only shrink.

## Two exported types with the same name in sibling modules is a live trap here

`store/sessions/types.ts` and `store/session-details/types.ts` both export
`SessionSummaryRow` with different shapes, and each module had its own
`hydrateSessionSummary`. A change meant for the session list was made to the detail-side
function: it typechecked, its own test passed, and the feature was simply absent until the
app was opened. The detail-side function is now `hydrateSessionDetailSummary`.

`bun run check:repository-standards` fails on any *new* duplicate exported type name under
`src/`, against a checked-in `KNOWN_DUPLICATE_EXPORTED_TYPES` list that can only shrink
(resolving one without removing it from the list also fails). `packages/extension-sdk`
deliberately mirrors shared types as its public surface, so the check is scoped to `src/`.

Rules considered and rejected as noise: duplicate *declared* function names (241 existing)
and duplicate *exported* function names (14). Only the type-name variant was both low-noise
and pointed at the actual trap. Note the function I edited was not exported at all, so an
export-only rule would never have caught it — the durable catch for that half is the
integration test on the live `listSessions` path.

## Lint and format toolchain (oxfmt + bun lint, ADR 0064)

One config, `oxlint.config.mts`, is run by `bun scripts/lint.ts` through a pinned Bun canary (`bun x bun@<BUN_LINT_VERSION> lint --no-script`) and by oxlint (`--runner=oxlint`, the fallback); oxfmt (`.oxfmtrc.json`) formats JS/TS only — its Markdown table padding mangled escaped backticks, its CSS pass re-indented Tailwind `@utility` blocks, and JSONC gained trailing commas, so those stay out. The config reproduces the gating rules of the removed tools per file scope (Biome: src/packages/fixtures/functions; ESLint: TS in src/packages/scripts/website/functions). Findings: ESLint's `import-x/no-cycle` never traversed `.ts` files (no `import-x/extensions` setting), so it was a no-op. oxlint's `import/no-cycle` found 126 real runtime cycles; they are fixed and the rule is on at `error`. Several oxlint equivalents are stricter than Biome's rules (`unicorn/no-array-for-each`, `prefer-tag-over-role`, `no-autofocus`, `exhaustive-deps`, `new-for-builtins`, `no-redeclare` on type+value pairs); Biome's `noForEach` is ported as `openwaggle/no-for-each`, the rest are off and listed in the config header. oxlint's `preserve-caught-error` (AggregateError) and `no-unreachable` (do…while with `continue`) false positives are scoped off per file. The rule tests run oxlint's RuleTester through `scripts/oxlint/__tests__/lint-rule.ts`, which collects reports instead of asserting so the old Linter-style assertions still read the same.

## Lint and type-check timing

Measured under load (load average 20-27 on 14 cores): oxlint over 1-3 files takes 3-5 s because the config is type-aware, so tsgolint builds the project program even without `--type-check`. The pinned `bun lint` canary took 7-21 s on the same small file lists. TypeScript 7 (`tsc` is the native compiler) checks all of `tsconfig.node.json` in 2.4-3.4 s and an incremental `tsc -b tsconfig.web.json` in 3-4.5 s. Pi loads extensions through jiti, which also resolves an extensionless dynamic `import()` of a `.ts` file.

Rules carry no ID scheme. `.agents/standards.md` names a public lint rule by its config name and gives each OpenWaggle rule its source; a finding cites the lint rule, the check step or `no-cheating/<kind>`, or a standards section. The former rule catalogue and its ID check were removed so that no rule exists without a public or OpenWaggle source.

## Filed under "Session-owned Browser preview (ADR 0031, September 2026)"

Under pnpm 11 (before ADR 0064), a script run could implicitly install when workspace manifests changed, including a version-only main merge, and that install ran Electron's native postinstall in the middle of Node verification. The rule that outlived it: finish manifest synchronization before rebuilding native modules for the intended runtime, and do not overlap native rebuilds and tests.

## Filed under "Access Modes And Authorization Memory"

- An Effect Schema `Struct` DELETES keys it does not declare, and a union annotated
  `Schema.Schema<SomeUnion>` makes that invisible to the compiler when the field is optional. A field
  added to a response type but not to its schema is silently dropped at the IPC boundary. This is how
  the approval scope was lost with the whole scoped-grant feature inert and every unit test green:
  the tests answered the broker directly and never crossed the schema. Any response field needs a
  decode test through the real schema.

## Filed under "Electron E2E launches ignore a running dev app, but a dirty tree blocks checkouts"

The dev server rewrites `src/renderer/src/routeTree.gen.ts` (import ordering only, no route change). Any script that checks out commits in sequence fails on every checkout while that file is dirty. Stop the dev server before such a loop.

## Filed under "Extension panel shortcuts are a separate, conflict-free map"

An Effect `Schema.Record` whose key schema is a refinement drops keys that fail the refinement instead of failing the decode. A saved map with a bad key would load with that entry silently gone. Validate keys with a filter on the whole record when a present invalid value has to fail closed.

## Filed under "Error reports (Sentry) and provider attribution"

Adding a dependency with `bun add` runs the root `postinstall` (`electron-builder install-app-deps`), which rebuilds native modules for Electron in the shared checkout and can fail half way on node-pty; pass `--ignore-scripts` and run `bun run prepare:native:node` or `prepare:native:electron` deliberately instead.

## Vendored skills and ADR numbers are checked offline (November 2026)

- `skills-lock.json` lists every `.agents/skills/<id>` directory: under `firstParty`, or under `skills` with each upstream's repository, path, full commit SHA and content hash. The content hash hashes each file's text with LF line endings and no trailing newlines, so the upstream copies that lost their final newline still count as pristine. A skill built from two sources (`write-a-skill`: one repository's SKILL.md plus another's scripts and license) has two upstreams, each with a `files` list, or one of them without a list covering the rest. `check:repository-standards` recomputes local hashes only; upstream hashes are stored when `bun scripts/skills-lock.ts record <id> --fetch` runs, and `drift` fetches each upstream one commit deep into `node_modules/.cache/openwaggle/skills-upstream/`. Fetching blobs lazily from a blobless clone took seconds per file, which is why the script uses shallow full fetches instead.
- Finding the vendored ref: list every blob id in the upstream's history (`git rev-list --all --objects`) and look up the local files' `git hash-object` ids; the commit where all of a skill's files match is the ref. Several upstreams had moved or renamed the skill since (`skill-creator` to `skills/skill-creator`, `diagnose` to `diagnosing-bugs`), which `drift` reports as moved or removed.
- The lock's upstream path for one skill sits under the legacy agent directory, so `skills-lock.json` is in the forbidden-reference exemptions.
- ADR numbers: twelve numbers were already shared by two ADRs each before the check existed. Those pairs are frozen in `scripts/standards/adr-numbering.ts` because code comments and docs cite them by number; renumbering would change what those citations mean. The 0063 pair was renumbered (parents-show-their-running-workers became 0065) because its references could be told apart by topic: refusal kinds and CLI machine output stay 0063, Running Workers, Done below and Ready to read moved to 0065.

## The check runner and its measurements (November 2026)

`scripts/check/run.ts` runs `check` and `verify` as a step graph (`scripts/check/steps.ts`; add a
step there and list it in a gate). Measured on a 14-core Mac at load 6-13: the old `check` chain
took 83-97 s plus 54-75 s of package smoke, run one after another; the graph's critical path is
the package smoke. Findings that shaped it:

- `tsconfig.node.json` included `packages/**/*.ts`, which matched the built
  `packages/*/dist/*.d.ts` whenever a package build had run, so the node program differed between
  a clean checkout (CI) and a local tree, and a typecheck running beside a package build could
  read half-written declarations. The dist folders are excluded now.
- TypeScript 7 `tsc -b` over the three projects: 11-13 s cold, 0.4 s with nothing changed,
  1.2-2.4 s after a function-body or renderer edit, but 8-13 s after an edit that changes a
  main-process or shared export (web and renderer-tests re-check against the new declarations).
  `bun check -b`: 3.1-4.2 s for any of these, and the same errors
  with the same locations on a probe set across the projects, including declaration-emit errors
  (TS4094). CI (4 vCPU, medians of 5): `bun check -b` 9.1 s cold against 45 s for
  `tsc -b --force`. So `bun check -b` is the one checker, locally and in CI (ADR 0064).
  The old `typecheck:tests` ran `tsc -b --force` twice (about 30 s).
- The repository standards check spent most of its time stripping comments: five rules each
  stripped the same file. One shared result plus one `git ls-files` pass took it from 3.8 s to
  2.1 s here.
- Vite prints a four-line `configLoader: 'native'` notice on every Vitest run because the root
  package.json has no `"type": "module"`; the test scripts and the runner set
  `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` rather than changing the module type.
- The package smoke's Bun consumer install once failed with `No version matching "^3.981.0" found
  for specifier "@aws-sdk/core"` and passed on the next run: a registry or cache hiccup, not a gate
  regression.

## No-cheating is a check step, never an in-session hook

The maintainer removed the end-of-turn agent gate (`.pi/extensions/quality-gates.ts`) because it prompted and posted into the conversation; no tool may ask the maintainer for permission. Its anti-cheat checks became the `no-cheating` step (`scripts/no-cheating/`), which compares the working tree with the merge base with `origin/main`. Base texts come from one `git cat-file --batch` process: 2,114 changed files take 1 to 1.6 s. `git ls-files -co` still lists a tracked file deleted from the working tree, so subtract `git ls-files --deleted`. `no-cheating/tsconfig` compares effect, because diffing `include`/`references` blocked a move of `scripts/` into a stricter project: `scripts/tsconfig-strictness` resolves the projects reachable from `tsconfig.json` with `typescript/unstable/async` (`new API({ cwd, fs: { readFile } })`, then `parseConfigFile`; `unstable/sync` fails under Bun on `stdout._handle.fd`). The `readFile` callback returning `undefined` falls back to disk and `null` means missing, which lets the base commit's configs run over today's file list. TypeScript asks for real paths, so on macOS map `/private/tmp` as well as `/tmp`. In TypeScript 7 `strict` defaults to true. Bun cannot tell a hand-edited `bun.lock` (`bun install --frozen-lockfile`, with `--dry-run` or `--lockfile-only`, accepted a changed version), and the TanStack route generator reruns forever over an in-memory fs, so neither is checked.

## Lint autofixes are unsafe on index reads while noUncheckedIndexedAccess is off (November 2026)

`src/main` does not check `noUncheckedIndexedAccess` yet, so `Record<string, boolean>[key]` types as `boolean` although a missing key reads `undefined`. `no-unnecessary-boolean-literal-compare --fix` rewrote `skillToggles[toggleId] !== false` (missing key means enabled) into `skillToggles[toggleId] &&` (missing key means disabled) and 8 provider-catalog tests failed. Review every autofix of that rule and of `no-unnecessary-condition` on an indexed read; make the type say so instead (`Partial<Record<…>>`). To clear a strict flag in one area before `tsconfig.node.json` turns it on, type-check a git-ignored `.tmp/<name>/<flag>.json` that extends `../../tsconfig.node.json` with `composite: false`, `noEmit: true`, `rootDir: "../.."` and the one flag, then filter `bunx tsc -p` output by path; a whole-project run takes about 9 s. TS4111 errors (`noPropertyAccessFromIndexSignature`) carry the property name and column, so a script can rewrite `.prop` to `['prop']` (and `?.prop` to `?.['prop']`) exactly. Under `exactOptionalPropertyTypes` the agent-kernel port's optional `piSessionFile` is filled with `piSessionFileField(session.sessionFile)` (`adapters/pi/agent-kernel/pi-session-file-field.ts`), which omits the key until Pi has written the file.
