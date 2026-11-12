# OpenWaggle Agent Standards

Root `AGENTS.md` is the entrypoint; this file holds the repository's rules. Every rule here has one of two sources:

- **A public lint rule.** The rule's name is the rule, and its public documentation says what it checks. `oxlint.config.mts` turns each one on, sets its options and says which files it covers.
- **OpenWaggle itself.** Each OpenWaggle rule names its source in parentheses: an ADR (`ADR 0064`), a memory topic (`memory: testing`), an OpenWaggle lint rule (`openwaggle/<name>`, documented in `scripts/oxlint/rules/`), a check step (`bun scripts/check/run.ts --list`), a fix commit, or `4bd0325e2`, the last change to this file before the Bun migration (`git show 4bd0325e2:.agents/standards.md`).

A finding cites a lint rule by its name (`typescript/no-floating-promises`), a check by its step id (`dependency-pins`) or no-cheating kind (`no-cheating/cast`), and any other rule by its section here (`standards.md#pi-runtime`).

## Lint rules

The full set is `oxlint.config.mts`, which also records why each rule that is off stays off. The ones reviews cite most, by area:

- Types: `typescript/consistent-type-assertions`, `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/no-unsafe-argument`, `typescript/no-unsafe-assignment`, `typescript/no-unsafe-call`, `typescript/no-unsafe-member-access`, `typescript/no-unsafe-return`, `typescript/no-unsafe-type-assertion`, `typescript/ban-ts-comment`, `typescript/no-unnecessary-condition`.
- Promises and `this`: `typescript/no-floating-promises`, `typescript/no-misused-promises`, `typescript/await-thenable`, `typescript/return-await`, `typescript/unbound-method`, `typescript/only-throw-error`.
- Imports: `import/no-cycle`, `typescript/consistent-type-imports`, `node/no-process-env`.
- React: `react/rules-of-hooks`, `react/jsx-key`, `react/refs`, `react/immutability`, `react/purity`, `react/set-state-in-effect`, `react/static-components`, the `jsx-a11y/*` rules, the `@tanstack/query/*` and `@tanstack/router/*` rules.
- Size and shape: `complexity`, `max-lines`, `max-lines-per-function`, `curly`, `no-console`.

## Type safety

- TypeScript stays `strict` with the strongest practical strictness flags (`4bd0325e2`). A tsconfig change may only check more, measured by effect on every source file (`no-cheating/tsconfig`).
- Instead of casts, use `satisfies`, explicit annotations, generics, type guards, discriminated unions and Effect Schema (`4bd0325e2`).
- `@total-typescript/shoehorn` only in tests, for partial mocks or intentionally invalid inputs (`openwaggle/no-shoehorn-outside-tests`).
- Validate runtime inputs at boundaries with the Effect Schema helpers in `src/shared/schema.ts` and the schemas under `src/shared/schemas/` (`4bd0325e2`).
- Read a fixed key with dot access, never `x['name']`; decoded outside data has declared fields, and a map keyed by a runtime value takes a variable key (`openwaggle/no-literal-key-lookup`, which fixes it).
- No silent parse fallbacks: log structured context or surface a visible error (`4bd0325e2`).
- No inline suppressions of any kind: fix the code, or change the shared config once with the reason there (`openwaggle/no-lint-directive-comments`, `openwaggle/no-architecture-ignore-comments`, `no-cheating/suppression`).
- Import types at the top of the file, not as inline `import()` types (`openwaggle/no-inline-import-types`).

## ts-match

Prefer `@diegogbrisa/ts-match` when pattern matching, exhaustive union handling, runtime guards or boundary assertions gain clarity or type safety from it; keep plain TypeScript for simple guard clauses or binary predicates (`4bd0325e2`, `ts-match/prefer-match-over-switch`, `ts-match/prefer-match-over-else-if`). Load `.agents/skills/ts-match/SKILL.md` before writing multi-branch discriminant or shape logic, runtime shape guards or boundary assertions.

## Main process architecture

Main-process code follows hexagonal architecture (ADR 0001, `openwaggle/main-architecture-boundaries`):

- Domain: pure business logic. No Electron, Node fs/process, SQL, Pi SDK or store imports.
- Ports: Effect service interfaces. No vendor SDKs or stores.
- Adapters: infrastructure and vendor code. App Pi SDK imports stay under `src/main/adapters/pi/`; `packages/pi-*` may import Pi SDKs.
- Application services: orchestration through ports. No direct store, IPC or Pi SDK imports.
- IPC handlers: transport only. Decode input, call an application service, return DTOs.
- Stores: persistence details behind ports and services.

In the renderer:

- A fire-and-forget `void api.*()` call handles its rejection, or it becomes an unhandled renderer error reported as a bare code (`openwaggle/no-uncaught-void-ipc`).
- No `typeof api.*` guards. The `api` proxy answers every name with a function, so the guard is always true; check a real capability with `'name' in api` (`openwaggle/no-api-typeof-guard`: a long paste vanished because such a guard never ran its fallback; `useAutoTextAttachment.component.test.tsx` covers the fix).

## Pi runtime

OpenWaggle is a UI and product shell over Pi, not a parallel runtime (ADR 0002, ADR 0051, `4bd0325e2`). Load `.agents/skills/pi-integration/SKILL.md` before Pi adapter, session projection, provider/auth/model, resource loading, MCP adapter or run orchestration work.

- Keep Pi-native session, tool, provider, model, auth, thinking-level and compaction semantics end to end.
- Provider, model and auth metadata come from Pi through OpenWaggle ports, never a parallel registry (`AGENTS.md`, `openwaggle/main-architecture-boundaries`).
- Translate Pi details into OpenWaggle-owned DTOs only at adapter boundaries.
- Add tool or runtime layers only as Pi-native extensions behind ports.
- Project resources resolve `.openwaggle > .pi > .agents` for skills, extensions, prompts and themes. Project config is `.openwaggle/settings.json`, with Pi settings under the nested `pi` key.
- Portable Waggle policy goes in `packages/waggle-core` with no Pi, OpenWaggle or Electron imports; Pi-specific Waggle behaviour goes in `packages/pi-waggle` (ADR 0004).

## Publishable package boundaries

`check:repository-standards` enforces these imports (`4bd0325e2`, `scripts/repository-package-boundaries.ts`):

- `packages/extension-sdk` stays browser-safe: no Electron, Node built-ins, Pi SDK, renderer stores, main-process services or app internals.
- `packages/waggle-core` stays runtime-neutral: no Pi SDK, Electron, Node built-ins, renderer stores or app services.
- `packages/extension-react` may use `@openwaggle/extension-sdk` and React peers, but no renderer components, app CSS, Tailwind internals, Electron or app services.
- `packages/pi-waggle` may import Pi SDKs, but not Electron, renderer stores or app services.

## Electron runtime

Load `.agents/skills/electron-runtime/SKILL.md` for child-process env, native ABI, packaging, CDP or startup issues.

- Main-process environment access goes through `src/main/env.ts` (`4bd0325e2`, `node/no-process-env`), and child processes get their environment from the env helpers, never a spread of `process.env` (`4bd0325e2`).
- Native modules keep separate Node and Electron rebuild paths, and a bug that only appears after packaging is verified in a packaged build (`4bd0325e2`).
- Main-process code logs through the structured loggers (`4bd0325e2`, `no-console`).
- Automated runs route window show and focus, native dialogs and external applications through the automation policy (`4bd0325e2`, `check:repository-standards`: `scripts/standards/electron-automation.ts`).
- Electron sits behind the desktop shell ports in `src/main/ports/desktop-shell/`. Only `src/main/adapters/electron/` and `src/preload/electron-transport.ts` import Electron; main code uses the bindings in `src/main/desktop-shell/` (ADR 0064, `openwaggle/desktop-shell-boundary`).

## Renderer

`docs/renderer-architecture.md` holds the detailed renderer rules (ADR 0003).

- React 19 with the React Compiler: no `React.memo`, `React.FC` or `forwardRef` (`4bd0325e2`, `openwaggle/no-react-legacy-patterns`). Chat and composer components compile with the React Compiler (check `react-compiler`).
- `useMemo` and `useCallback` only for identity an external API needs, not render optimization (`4bd0325e2`).
- Prefer focused Zustand selectors and feature-owned hooks over prop-drilled controller objects (`4bd0325e2`, `openwaggle/jsx-max-props`).
- Features live under `src/renderer/src/features/<feature>/` and import each other through public indexes (`4bd0325e2`, `openwaggle/renderer-import-boundaries`).
- Shared primitives live under `src/renderer/src/shared/` and `src/renderer/src/shell/`; use them instead of raw buttons (`4bd0325e2`, `openwaggle/no-raw-renderer-buttons`; website templates: `scripts/standards/astro-raw-buttons.ts`).
- Styles use the design tokens: no arbitrary snapped values, raw hex or Tailwind palette colours. The per-file exemption list only shrinks (ADR 0024, `openwaggle/renderer-design-token-guardrails`, `no-cheating/only-shrinks`).
- React Doctor reports nothing (`AGENTS.md`, check `react-doctor`).

## Testing

- Unit, integration and component tests live in nearby `__tests__/` folders; route-adjacent TanStack Router test files use the configured ignored filename pattern (`4bd0325e2`, `openwaggle/test-colocation`).
- Tests verify behaviour through public interfaces, with typed builders, `satisfies` and Shoehorn helpers instead of casts: `fromPartial` for a partial fixture that still matches the shape, `fromAny` only for intentionally invalid input, `fromExact` when the test must supply the full type (`4bd0325e2`). A response field gets a decode test through the real schema: an Effect Schema `Struct` drops keys it does not declare, which once lost the approval scope while every test that answered the broker directly stayed green (memory: tooling).
- A mocked `@/shared/lib/ipc` answers like the real bridge (memory: testing).
- Mock only what leaves the process: the network, child processes, Electron, the clock, and files outside a temporary directory. Code inside the process runs for real. The test-suite audit before v1 found tests that only checked their own mocks and rewrote them against real collaborators (renderer `vi.mock` calls 203 → 85 in those files).
- A test earns its place by catching a change no other test catches. Before adding a case, find the subject's existing tests and add a row to their `it.each` table instead of a near-copy (test-suite audit).
- Test a behaviour once, at the lowest tier that can show it (test-suite audit).
- Constants, getters, re-exports, types and a mock's value passed straight through get no test (test-suite audit).
- A regression test says which bug it guards, in its name or a one-line comment (test-suite audit).
- Avoid `vi.mock` hoisting races: import the subject dynamically after the mock setup when needed (`4bd0325e2`).
- A test that spawns many real child processes is an integration test, and a large module graph loads once in `beforeAll` with its own timeout (memory: testing).
- A new test file should cover a statement or branch arm no other test covers. Zero unique coverage is a candidate for review, not a verdict: contract and refusal tests legitimately show none (check `coverage-uniqueness`, advisory).
- Never skip, focus or delete a test to get a change through (`no-cheating/test`).

## Tooling and style

- TypeScript for project tooling and config files when it is supported (`4bd0325e2`, `check:repository-standards`).
- No TypeScript `baseUrl`; use explicit `paths` entries (`4bd0325e2`, `check:repository-standards`).
- `while (true)`, not `for (;;)` (`4bd0325e2`, `openwaggle/no-infinite-for-loop`).
- Numeric literals outside tests are named `SCREAMING_SNAKE_CASE` constants (`4bd0325e2`, `openwaggle/no-inline-magic-numbers`).
- Bun only: `bun install`, `bun run`, `bunx`. No npm, pnpm, yarn or tsx (ADR 0064).
- oxfmt formats JavaScript and TypeScript with `.oxfmtrc.json` (ADR 0064, check `format`).
- Change generated files only by running their generator (`no-cheating/generated-file`; the usage statistics catalog, API snapshots and package docs have their own check steps).
- A skill copied from another repository is pinned in `skills-lock.json`; record an edit to it, with the reason, through `bun scripts/skills-lock.ts record <skill> --reason "<why>"` (`check:repository-standards`: `scripts/standards/skills-lock.ts`, memory: tooling).
- ADR numbers are unique and contiguous, and each ADR is listed in the index in `docs/architecture.md`. The numbers two ADRs already shared are frozen in `scripts/standards/adr-numbering.ts` (`check:repository-standards`, `no-cheating/only-shrinks`, memory: tooling).

## Dependencies

`docs/dependency-updates.md` says when and how to move a pin.

- Direct dependencies and catalog entries are exact versions; `workspace:` and `catalog:` references pass (`docs/dependency-updates.md`, `check:repository-standards`, check `dependency-pins`).
- A pin that is not npm's `latest`, or that something holds where it is, has a line in `DEPENDENCIES.md` (check `dependency-pins`).
- A release-age exception in `bunfig.toml` names one exact `name@version` with its reason, and goes once that version is seven days old (`docs/dependency-updates.md`; Pi entries: check `pi-runtime`). This holds for `@diegogbrisa/ts-match` too.

## Git

- Commit subjects are Conventional Commits: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`, `build` or `revert` (check `commits`, the `commit-msg` hook).
- Hooks always run, and force pushes are refused: the `pre-push` hook refuses a push that drops commits, and `.pi/extensions/git-guardrails.ts` blocks skipping hooks and force pushing, with no prompt (`.agents/verification.md`).
- Commit, push, reset, clean, checkout, restore or delete branches only when the maintainer approved that exact action, and never overwrite work you did not create (`AGENTS.md`).

## No cheating

A finding is fixed in code. A false positive gets a `.fallowrc.jsonc`, `doctor.config.ts` or `oxlint.config.mts` entry with its reason, never a suppression comment (`AGENTS.md`, Definition of Done).

The `no-cheating` check step (`bun run check:no-cheating`, `scripts/no-cheating/`) fails a change that gets through by checking less. It compares the working tree with the merge base with `origin/main`, runs in `check`, `verify` and CI, asks nothing, and prints one `file:line [no-cheating/<kind>] message` line per finding:

- `suppression`: a new lint or type-check directive comment.
- `cast`: a new `as any`, `as unknown as` or `as never`, including in files lint does not cover.
- `tsconfig`: a source file no project reachable from `tsconfig.json` checks any more, or a strictness flag that got weaker for some file.
- `lint-config`: a rule turned off or down to a warning, a new ignore or exemption entry, a raised limit or a check option turned off in `oxlint.config.mts`, `.fallowrc.jsonc` or `doctor.config.ts`, with no comment saying why.
- `budget`: a raised bundle, output, first-turn prefix, memory token or syntax performance budget, or a lowered coverage threshold.
- `only-shrinks`: a new entry in a list that only shrinks: the design-token and renderer-test type exemptions, the legacy ADR numbers, and the files over the size limits (`OVERSIZED_FILES` in `oxlint.config.mts`). `scripts/no-cheating/ratchets.ts` lists what it watches.
- `test`: a new `.skip`, `.only` or `.todo`, a `skipIf` or `runIf` with no comment saying when it runs, or a deleted test file whose code still exists.
- `generated-file`: a published JSON Schema or the syntax language metadata that differs from what its generator writes.

## Docs and memory

- User docs in `website/src/content/docs/` follow the `write-docs` skill (ADR 0061).
- Significant technical findings go in the matching `.agents/memory/<topic>.md`, within its token cap (`AGENTS.md`, `check:repository-standards`: `scripts/standards/agent-memory.ts`).
- Prose follows the `unslop` skill (`.agents/skills/unslop/SKILL.md`).
