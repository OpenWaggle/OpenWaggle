# Tooling

Build and static tooling: the oxfmt and `bun lint` toolchain, TypeScript posture, dependency
update traps, repository-standards checks, Effect Schema traps, and package-manager notes.
Load when touching lint or format config, `tsconfig*`, `package.json` dependencies or
`scripts/check-*`.

## Tooling Memory

- Package manager: Bun (`bun install`, `bun.lock`, `bun run`; ADR 0064). pnpm was used until then.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are the target strictness posture, but enabling them in build or lint tsconfigs requires a dedicated source-modeling pass across the active Pi/session refactor; lint-only enablement can create TypeScript `error` types that surface as noisy Oxlint `typescript/no-unsafe-*` diagnostics.
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

One config, `oxlint.config.mts`, is run by `bun scripts/lint.ts` through a pinned Bun canary (`bun x bun@<BUN_LINT_VERSION> lint --no-script`) and by oxlint (`--runner=oxlint`, the fallback); oxfmt (`.oxfmtrc.json`) formats JS/TS only — its Markdown table padding mangled escaped backticks, its CSS pass re-indented Tailwind `@utility` blocks, and JSONC gained trailing commas, so those stay out. The config reproduces the gating rules of the removed tools per file scope (Biome: src/packages/fixtures/functions; ESLint: TS in src/packages/scripts/website/functions). Findings: ESLint's `import-x/no-cycle` never traversed `.ts` files (no `import-x/extensions` setting), so it was a no-op — oxlint's `import/no-cycle` finds 126 real runtime cycles and stays off until they are fixed. Several oxlint equivalents are stricter than Biome's rules (`unicorn/no-array-for-each`, `prefer-tag-over-role`, `no-autofocus`, `exhaustive-deps`, `new-for-builtins`, `no-redeclare` on type+value pairs); Biome's `noForEach` is ported as `openwaggle/no-for-each`, the rest are off and listed in the config header. oxlint's `preserve-caught-error` (AggregateError) and `no-unreachable` (do…while with `continue`) false positives are scoped off per file. The rule tests run oxlint's RuleTester through `scripts/oxlint/__tests__/lint-rule.ts`, which collects reports instead of asserting so the old Linter-style assertions still read the same.

## End-of-turn agent gate and the rule catalogue

`.pi/extensions/quality-gates.ts` runs `scripts/agent-gate` at `agent_before_settle`. Measured under load (load average 20-27 on 14 cores): oxlint over 1-3 changed files takes 3-5 s because the config is type-aware, so tsgolint builds the project program even without `--type-check`, and `--type-check` adds almost nothing. The pinned `bun lint` canary took 7-21 s on the same small file lists, so the gate uses the oxlint runner (same config, same findings); `bun run lint` keeps the canary. TypeScript 7 (`tsc` is the native compiler) checks all of `tsconfig.node.json` in 2.4-3.4 s and an incremental `tsc -b tsconfig.web.json` in 3-4.5 s, so a whole-project type check in parallel with lint beat an importer search plus type-checked lint (8-11 s when exports changed). Fallow and React Doctor analyze the whole project and add about 5 s. `git grep` over the repository took 0.5-2.2 s under the same load. Pi loads extensions through jiti, which also resolves an extensionless dynamic `import()` of a `.ts` file. Bash `tool_result` carries `structuredContent.exit_code`, which is how the gate tells a passing test run from a failing one. `.agents/rules.json` is capped at 3,500 o200k tokens (about 3,000 today) by `check:repository-standards`; lint output appends the ID from each rule's `by` list.

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
