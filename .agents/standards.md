# OpenWaggle Agent Standards

Centralized repository standards for AI coding agents. Root `AGENTS.md` is the entrypoint; this file carries the durable details.

## Two principles

These decide what to do when a gate or a type stands in the way.

- **Broken Window.** A change never adds a warning, a suppression, a skipped or disabled check, or a test marked to skip, and a gate never goes back to accepting one. When a gate reports something, fix its cause. If the rule itself is wrong for this repository, change it once in the shared config or the rule catalogue with the reason recorded there, so every file gets the same decision. One tolerated finding makes the next one look normal, and the gate stops meaning anything. [GATE-03]
- **System Resistance.** When a tool, check or type fights a change, read that as information about the design: the change crosses a boundary, a type is modelled wrong, or the change belongs somewhere else. Do not route around it with a cast, a suppression, a disabled check or a wider exemption list. Find out what the resistance protects, then change the design or ask for a rule decision. A workaround is accepted only when the tool is demonstrably wrong; report that upstream and record it with the rule decision. [GATE-04]

Each rule cites its stable ID from `.agents/rules.json`, the machine-readable catalogue. Lint output, the `no-cheating` check step and the `standards-reviewer` Agent cite the same IDs, so a finding names the rule it breaks. `check:repository-standards` keeps every ID unique, defined and cited here.

## Type Safety

Type safety is stricter than convenience.

- TypeScript stays `strict` and uses the strongest practical strictness flags. A tsconfig change may only make checking stricter: every source file stays checked by some project reachable from `tsconfig.json`, and no strictness flag gets weaker for any file. Moving files to a stricter project, adding a reference and excluding build outputs are fine. The `no-cheating` check step compares by effect, not by the diff, and nothing approves a weaker change. [TS-01]
- Raw type assertions are forbidden everywhere except `as const`. [TS-02]
- Use `satisfies`, explicit annotations, generics, type guards, discriminated unions, and Effect Schema instead of casts. [TS-03]
- Use `@total-typescript/shoehorn` only in tests, and only when a test needs partial mocks or intentionally invalid inputs. [TS-04]
- Never use `any`, `as unknown as`, `as never`, handler casts, `Record<string, unknown>` casts, or `// SAFETY:` comments. The `no-cheating` step also fails a new `as any`, `as unknown as` or `as never` in files lint does not cover. [TS-05]
- Runtime inputs must be validated at boundaries with shared Effect Schema helpers from `src/shared/schema.ts` and schemas under `src/shared/schemas/`. [TS-06]
- Do not use silent parse fallbacks. Log structured context or surface a visible error path. [TS-07]

Mechanical enforcement:

- Oxlint's `typescript/consistent-type-assertions` bans raw assertions while allowing `as const`.
- Oxlint's tsgolint-powered, type-aware `typescript/no-unsafe-*` rules catch unsafe flow from dependencies; intentional test and boundary exceptions stay narrowly scoped in `oxlint.config.mts`.
- `openwaggle/no-shoehorn-outside-tests` keeps Shoehorn test-only.
- The lint config (`oxlint.config.mts`, run by `bun lint` with oxlint as the fallback runner) bans explicit `any`, non-null assertions, unsafe patterns, and every inline lint directive (`eslint-disable*`, `oxlint-disable*`, `/* eslint */`, `/* global */`): fix the code or change the shared config, never the line. The same goes for `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore` and `fallow-ignore`. [TS-08]

## ts-match

OpenWaggle prefers `@diegogbrisa/ts-match` when pattern matching, exhaustive union handling, runtime guards, or boundary assertions improve clarity or type safety. [TS-09]

Before writing manual multi-branch discriminant/shape logic, runtime shape guards, or boundary assertions, load `.agents/skills/ts-match/SKILL.md` and apply its guidance.

Keep plain TypeScript for simple guard clauses or binary predicates where `ts-match` would add noise.

## Main Process Architecture

Main process code follows hexagonal architecture.

- Domain: pure business logic. No Electron, Node fs/process, SQL, Pi SDK, or store imports. [ARCH-01]
- Ports: Effect service interfaces. No vendor SDKs or stores. [ARCH-02]
- Adapters: infrastructure and vendor code. OpenWaggle app Pi SDK imports stay under `src/main/adapters/pi/`; dedicated Pi packages may import Pi SDKs inside `packages/pi-*`. [PI-01]
- Application services: orchestration through ports. No direct stores, IPC, or Pi SDK imports. [ARCH-03]
- IPC handlers: transport only. Decode input, call application services, return DTOs. [ARCH-04]
- Stores: persistence implementation details behind ports/services. [ARCH-05]

Mechanical enforcement:

- `openwaggle/main-architecture-boundaries` enforces Pi isolation, domain purity, no provider registry, and store/application/IPC boundaries.
- Fallow reports import cycles; oxlint's `import/no-cycle` stays off until the existing cycles are gone. [ARCH-06]
- `openwaggle/no-uncaught-void-ipc` rejects fire-and-forget IPC calls that drop their rejection. [ARCH-07]
- `openwaggle/no-api-typeof-guard` rejects `typeof api.*` guards in the renderer: the `api` proxy answers every name with a function, so the guard is always true and its fallback is dead. The typed preload contract makes the member exist; handle the call's rejection, or check a real capability such as `'name' in api`, which the proxy answers from the loaded preload. [ARCH-08]

## Pi Runtime

OpenWaggle is a UI and product shell over Pi, not a parallel runtime.

- Keep Pi-native session, tool, provider, model, auth, thinking-level, and compaction semantics end-to-end. [PI-02]
- Provider, model and auth metadata come from Pi through OpenWaggle ports, never a parallel OpenWaggle registry. [PI-05]
- Translate Pi details only at adapter boundaries into OpenWaggle-owned DTOs. [PI-03]
- Do not add custom OpenWaggle tool/runtime layers unless implemented as explicit Pi-native extensions behind ports. [PI-04]
- Project resources follow `.openwaggle > .pi > .agents` precedence for skills, extensions, prompts, and themes. [PI-06]
- OpenWaggle project config is `.openwaggle/settings.json`; Pi settings live under the nested `pi` key. [PI-06]
- Portable Waggle policy belongs in `packages/waggle-core` without Pi/OpenWaggle/Electron imports; Pi-specific Waggle behavior belongs in `packages/pi-waggle`. [PI-07]

Load `.agents/skills/pi-integration/SKILL.md` before Pi adapter, session projection, provider/auth/model, resource loading, MCP adapter, or run orchestration work.

## Publishable Package Boundaries

OpenWaggle publishable packages must preserve their public contract boundaries.

- `packages/extension-sdk/**` must stay browser-safe. Do not import Electron, Node built-ins, Pi SDK packages, renderer stores, main-process services, or OpenWaggle app internals. [PKG-01]
- `packages/waggle-core/**` must stay runtime-neutral reusable policy. Do not import Pi SDK packages, Electron, Node built-ins, renderer stores, or app services. [PKG-02]
- `packages/extension-react/**` may depend on `@openwaggle/extension-sdk` and React peers, but must not import OpenWaggle renderer components, app CSS, Tailwind internals, Electron, or app services. [PKG-03]
- `packages/pi-waggle/**` may import Pi SDK packages, but must not import Electron, renderer stores, or OpenWaggle app services. [PKG-04]
- These import boundaries must be enforced by `bun run check:repository-standards`, not only by review.

## Electron Runtime

- Main-process environment access is centralized in `src/main/env.ts`. [SHELL-01]
- Child processes must use the appropriate env helper instead of spreading `process.env` directly. [SHELL-02]
- Native modules need separate Node and Electron rebuild paths. [SHELL-03]
- Packaged runtime behavior must be validated in packaged app builds when the bug only appears after packaging. [SHELL-03]
- Main process logging uses structured loggers, not raw `console.*` outside logger modules. [SHELL-04]
- Automated Electron runs must route OS-visible actions through the centralized automation policy. Repository checks reject unguarded window-show/focus, native-dialog, and external-application calls outside that boundary. [SHELL-05]
- Electron sits behind the desktop shell ports (`src/main/ports/desktop-shell/`, ADR 0064). Only `src/main/adapters/electron/` and `src/preload/electron-transport.ts` (plus preload tests) import `electron`, `electron-updater` or `@electron-toolkit/*`; only the crash-reporting adapter and bridges import `@sentry/electron`. Main code uses the bindings in `src/main/desktop-shell/`. [SHELL-06]

Load `.agents/skills/electron-runtime/SKILL.md` for child-process env, native ABI, packaging, CDP, or Electron runtime startup issues.

## Renderer

Detailed renderer architecture rules live in `docs/renderer-architecture.md`.

- React 19 and React Compiler are enabled; do not use `React.memo`, `React.FC`, or `forwardRef`. [REACT-01]
- Use `useMemo`/`useCallback` only for semantic identity required by an external API, not render optimization. [REACT-02]
- Prefer focused Zustand selectors and feature-owned hooks over prop-drilled controller objects. [REACT-03]
- Renderer features live under `src/renderer/src/features/<feature>/` with public indexes for cross-feature imports. [REACT-04]
- Shared renderer primitives live under `src/renderer/src/shared/` and `src/renderer/src/shell/`. [REACT-05]
- Use the shared UI primitives instead of raw renderer buttons except inside primitive implementations. [REACT-05]
- Route-adjacent TanStack Router test files need the configured ignored filename pattern. [TEST-01]

Mechanical enforcement:

- `openwaggle/renderer-import-boundaries` enforces feature boundaries.
- `openwaggle/no-raw-renderer-buttons` enforces shared button usage.
- `openwaggle/renderer-design-token-guardrails` rejects arbitrary snapped-family values, raw renderer hex colors, and Tailwind palette colors. Its binary per-file exemption list can only shrink. [REACT-06]
- `openwaggle/jsx-max-props` discourages prop-drilled components.
- React Doctor catches React Compiler and renderer anti-patterns, and `check:react-compiler` fails on a function the compiler leaves uncompiled. [REACT-07]

## Testing

- Unit, integration, and component tests live in nearby `__tests__/` folders. [TEST-01]
- Mock setup must avoid hoisting races; dynamically import subject modules after `vi.mock(...)` setup when needed. [TEST-03]
- A test that spawns many real child processes is an integration test, and a large module graph loads once in `beforeAll` (`.agents/verification.md`). [TEST-04]
- After changing source, run the relevant tests in the same turn and leave them passing.
- Never skip, focus or delete a test to get a change through. The `no-cheating` step fails a new `.skip`, `.only` or `.todo`, a `skipIf` or `runIf` with no comment saying when it runs, and a deleted test file that did not move and whose code still exists or cannot be told. [GATE-03]

A meaningful test fails when the behaviour it names breaks, and only one test fails for that reason. The rules below decide whether a test is kept, merged or cut; the evidence behind them is the test-suite audit of 2026-11 (2,429 unit, 337 integration and 528 component files).

- Test behaviour at a public seam: an exported function or class, an IPC handler, a hook, a rendered component, a persisted file or row. Assert what a caller can observe: return values, refusals, persisted or emitted data, rendered output. Do not assert the call order or count of mocks standing in for the subject's own collaborators, private helpers, internal fields, or log text that nothing reads. Mock only process boundaries (network, clock, Electron, child processes, OS calls a temporary directory cannot sandbox, other Sessions); use real in-process collaborators, in-memory ports and temporary directories for the rest. Use typed builders, `satisfies`, and Shoehorn test helpers instead of casts. [TEST-02]
- Each test must cover a branch or kill a mutant that no other test covers or kills. Before adding a case, find the subject's existing tests (`rg` the export name in `__tests__/`); extend an `it.each` table rather than copying a case with new data; test a behaviour once, at the lowest tier that observes it, and let a higher tier add only the wiring it alone exercises. Do not test constants, getters, re-exports, default values, mocked return values passed through, or facts the type checker proves, and do not snapshot or dump large literal structures. A channel-list test is kept only for channels no other case invokes. A test for a fixed bug names the issue or fix commit it pins. [TEST-06]

How to apply TEST-02 and TEST-06 in review:

| Kind of test | Verdict |
|---|---|
| Behaviour at a public seam with real or faithful collaborators | keep |
| Regression test for a real bug, naming the issue or fix | keep |
| Contract test: IPC, schema, wire or persisted format, port conformance, a boundary refusal | keep, even when coverage shows no unique line (schemas are declarative, so coverage cannot see what a refusal test adds) |
| Same behaviour as a sibling case with other data | merge into an `it.each` table |
| Exact or near copy of a case in another file (often left by a file split) | delete the copy |
| Asserts mock calls, private helpers, internal state or log text | rewrite against the outcome, or delete when another case already asserts the outcome |
| Mocks the subject's own collaborators until the assertion is about the mock | rewrite with real collaborators, or delete |
| Trivial: constants, getters, re-exports, types, mocked values passed through | delete |
| Snapshot or literal dump where most fields are incidental | assert the fields that matter |

Zero unique coverage alone is not a reason to delete: in the audit most such files asserted outcomes (file modes, race orderings, refusals) that no other test asserted. Delete when coverage shows no unique line or branch, the mutation sample shows no unique kill, and a reviewer can name the test that already asserts the same outcome.

Mechanical enforcement:

- `openwaggle/test-colocation` rejects loose non-E2E test files under `src/`.
- Vitest configs split unit, integration, component, and coverage runs.

## Tooling And Style

- Use TypeScript for project tooling when supported, and do not add JavaScript config/tooling files when a TypeScript equivalent is practical. [TOOL-01]
- Use Bun only: `bun install`, `bun run`, `bunx`. No npm, pnpm, yarn or tsx. [TOOL-06]
- Do not add TypeScript `baseUrl`; use explicit `paths` entries. [TOOL-02]
- Avoid inline `import()` types in source files; import types at the top. [TS-10]
- Use `while (true)`, not `for (;;)`. [TOOL-03]
- Use named `SCREAMING_SNAKE_CASE` constants for numeric literals outside tests. [TOOL-04]
- Do not add `eslint-disable`, `oxlint-disable`, or `fallow-ignore` comments to bypass architecture/style gates. [TS-08]
- Change generated files (the route tree, API snapshots, `bun.lock`, generated docs and schemas) only by running their generator. The `no-cheating` step fails a published JSON Schema or the syntax language metadata when it differs from what the generator writes (`scripts/no-cheating/generated-files.ts`), and the catalog, API snapshot and package doc steps check theirs. [TOOL-07]
- Stay inside the complexity, `max-lines`, `max-lines-per-function` and naming limits in `oxlint.config.mts`. [TOOL-08]
- A skill copied from another repository is pinned in `skills-lock.json` (upstream repository, path, commit, content hash). Record an edit to it, with the reason, through `bun scripts/skills-lock.ts record <skill> --reason "<why>"`; `bun scripts/skills-lock.ts drift` reports upstream changes on demand and needs the network. [TOOL-09]
- ADR numbers are unique and contiguous. A new ADR takes the next free number and is listed in the ADR index in `docs/architecture.md`. [DOC-05]

Mechanical enforcement:

- The OpenWaggle lint plugin (`scripts/oxlint/`) catches inline import types, `for (;;)`, raw renderer buttons, lint directive and architecture bypass comments, and inline magic numbers; `bun run check:repository-standards` catches raw `<button>` in website Astro templates.
- oxfmt (`.oxfmtrc.json`) formats JavaScript and TypeScript: single quotes, no semicolons, trailing commas, width 100. [TOOL-05]
- `bun run check:repository-standards` catches repository standards drift, including vendored skills that differ from `skills-lock.json` without a recorded reason, skill directories the lock does not list, and ADR numbers that repeat, leave a gap or are missing from the ADR index. The ADR numbers that two ADRs already shared are frozen in `scripts/standards/adr-numbering.ts`; that list never grows.

## Dependencies

- Direct dependencies and catalog entries are exact versions; `workspace:` and `catalog:` references pass (`docs/dependency-updates.md`). [DEP-01]
- Add a dependency only when the maintainer approved it. Review checks this; no tool does.
- A pin that is not the latest release, or that has a reason (a patch, an override, a known break in the next release), has a row in `DEPENDENCIES.md`. `bun run check:dependency-pins` fails a new or changed pin without one. [DEP-03]
- A release-age exception names one exact `name@version` with its reason. [DEP-04]

## Git

- Commit subjects use Conventional Commits with `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`, `build` or `revert`. [GIT-01]
- Never skip or disable git hooks, and never force push without the maintainer's approval. [GIT-02]
- Commit, push, reset, clean, checkout, restore or delete branches only when the maintainer approved that exact action, and never overwrite work you did not create. [GIT-03]

## No cheating

The `no-cheating` check step (`bun run check:no-cheating`) fails a change that gets through by checking less, comparing the working tree with the merge base with `origin/main`. It runs in `check`, `verify` (pre-push) and CI, asks nothing, and prints one `file:line [ID] message` line per finding. There is no in-session hook. `.agents/verification.md` lists its checks.

- Fallow dead-code and duplication findings in changed files are fixed; a false positive gets a config entry with its reason, never a suppression comment. [GATE-02]
- A lint config change that checks less (a rule turned off or down to a warning, a new ignore or exemption entry, a raised limit) in `oxlint.config.mts`, `.fallowrc.jsonc` or `doctor.config.ts` carries a comment that says why, on the entry or above its group. [GATE-03]
- Never raise a budget, cap or coverage threshold (bundle, output-token, first-turn prefix, memory and rule-catalogue budgets), or grow an only-shrinks list (the design-token and renderer-test type exemptions, the legacy ADR numbers). Get under the limit instead; `scripts/no-cheating/ratchets.ts` lists what the step watches. [GATE-05]

## Docs and memory

- When a change makes an ADR or doc wrong, update it in the same change.
- User docs in `website/src/content/docs/` follow the `write-docs` skill (ADR 0061). [DOC-02]
- Significant technical findings go in the matching `.agents/memory/<topic>.md`, within its token cap. [DOC-03]
- Prose follows the `unslop` skill. [DOC-04]

## Lint Rule Decisions

The strictness triage ran every oxlint rule, the correctness category and eslint-plugin-sonarjs over the code base, sampled the findings of each rule with more than about 50, and kept a rule when its findings were mostly real problems or one consistent spelling. Counts are the findings when the rule was decided.

Adopted, at `error` on every type-aware file (`STRICT_RULES` and `REACT_COMPILER_RULES` in `oxlint.config.mts`, plus the correctness category). [TOOL-10] [TOOL-11] [TOOL-12]

- Promise and `this` bugs: `no-floating-promises` (130), `no-misused-promises` (36), `await-thenable` (6), `return-await` with `error-handling-correctness-only` (8), `unbound-method` (80 outside tests), `only-throw-error` (10), `use-unknown-in-catch-callback-variable` (25), `no-implied-eval` (1).
- Stringify and spread mistakes: `no-base-to-string` (38), `restrict-template-expressions` with numbers, booleans, nullish values and regexps allowed (6), `no-misused-spread` (22), `require-array-sort-compare` with string arrays allowed (9).
- Types that say less than they seem to: `no-redundant-type-constituents`, `no-duplicate-type-constituents`, `no-unnecessary-type-parameters`, `no-unnecessary-type-arguments`, `no-unnecessary-boolean-literal-compare`, `no-unnecessary-template-expression`, `no-unnecessary-type-conversion`, `no-meaningless-void-operator`, `no-useless-default-assignment`, `no-inferrable-types`, `no-unnecessary-qualifier`, `non-nullable-type-assertion-style`.
- One spelling: `array-type` (222), `consistent-type-definitions` set to `interface` (58), `consistent-indexed-object-style` (83), `consistent-generic-constructors`, `prefer-optional-chain` (55), `prefer-for-of`, `prefer-includes`, `prefer-string-starts-ends-with`, `prefer-reduce-type-parameter`, `prefer-return-this-type`, `dot-notation` with index-signature access allowed, `curly` set to `multi-line` (580), `unicorn/no-new-array`, `unicorn/no-useless-fallback-in-spread`.
- `import/no-cycle` (0 after the Fallow cycle work).
- `no-console` in `src/` and `functions/`, except the two logger sinks, the functions log sink and tests.
- `no-unnecessary-condition` only on packages, scripts, `.pi` and the build configs, the projects that check `noUncheckedIndexedAccess`. Elsewhere it reports every guard on an indexed read. Node types `process.stdout.columns` and the DOM types `document.body` as always set, so code that guards them reads `isTTY` or `querySelector('body')` instead of `??`.
- React Compiler rules on renderer and `extension-react` components: `refs` (33), `set-state-in-effect` (22), `immutability`, `purity`, `globals`, `static-components`, `use-memo`, `preserve-manual-memoization`.

Rejected rules stay off, with the reason below. [TOOL-14]

| Rule | Findings | Why |
| --- | --- | --- |
| `curly` (`all`) | 15,209 | Almost all single-line `if (x) return`. `multi-line` keeps the 580 real cases. |
| `vitest/require-mock-type-parameters` | 7,446 | `vi.fn(impl)` already infers from its implementation. |
| `no-confusing-void-expression` | 4,366; 133 with `ignoreArrowShorthand` | Mostly `vi.waitFor(() => expect(...))`; the rest return a void call from a void function, which is harmless. |
| `require-await` | 2,782 | 2,700 are test doubles that must be `async` to fit a Promise-returning type. |
| `no-empty-function` | 500 | Deliberate no-ops: `.catch(() => {})`, default callbacks. |
| `no-invalid-void-type` | 227 | Reports `Promise.withResolvers<void>()` and `Deferred<void>`. |
| `prefer-nullish-coalescing` | 93 | The `||` sites map empty strings to a fallback on purpose. |
| `unicorn/no-array-for-each` | 94 | Style only. |
| `no-dynamic-delete` | 72 | Deletes keys from JSON-shaped settings records on purpose. |
| `unicorn/no-useless-spread` | 79 | Its fix drops copies taken before a loop that changes the collection. |
| `unicorn/no-thenable` | 3 | All three are JSON Schema's `if`/`then`/`else`. |
| `promise/no-callback-in-promise`, `import/default` | 8, 1 | State setters called in `.then`; Vite's `?worker&url` imports. |
| `jest/*` test-shape rules (`expect-expect`, `valid-expect`, `no-conditional-expect`, `no-standalone-expect`, `require-to-throw-message`, `valid-describe-callback`) | 102–308 each | Vitest takes a message argument and an options object, and the suite asserts through helpers. The `jest` plugin also duplicates every `vitest/*` rule, so only one set runs. |
| `jsx-a11y` `prefer-tag-over-role`, `no-autofocus`, `no-noninteractive-*`, `interactive-supports-focus`; `react/exhaustive-deps` | 1–78 each | Already covered or deliberately off, see the config header. |
| `eslint-plugin-sonarjs` | 43,222 with everything on | Every rule with findings was a false positive or style here (`publicly-writable-directories` on `/tmp` test paths, `file-permissions` on test `chmod`, `updated-loop-counter` in scanners that skip ahead, `reduce-initial-value` behind an empty check). Nine of its rules added 2–4s locally; all of them doubled CI lint time. |

Every adopted rule applies to every file it targets, with no per-file exemptions: the 1,439 findings in `src/` that were pending when the rules landed are fixed. [TOOL-13] Still pending: `isolatedDeclarations` for `@openwaggle/extension-sdk` (380 findings).
