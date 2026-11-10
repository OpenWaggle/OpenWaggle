# OpenWaggle Agent Standards

Centralized repository standards for AI coding agents. Root `AGENTS.md` is the entrypoint; this file carries the durable details.

## Two principles

These decide what to do when a gate or a type stands in the way.

- **Broken Window.** A change never adds a warning, a suppression, a skipped or disabled check, or a test marked to skip, and a gate never goes back to accepting one. When a gate reports something, fix its cause. If the rule itself is wrong for this repository, change it once in the shared config or the rule catalogue with the reason recorded there, so every file gets the same decision. One tolerated finding makes the next one look normal, and the gate stops meaning anything.
- **System Resistance.** When a tool, check or type fights a change, read that as information about the design: the change crosses a boundary, a type is modelled wrong, or the change belongs somewhere else. Do not route around it with a cast, a suppression, a disabled check or a wider exemption list. Find out what the resistance protects, then change the design or ask for a rule decision. A workaround is accepted only when the tool is demonstrably wrong; report that upstream and record it with the rule decision.

## Type Safety

Type safety is stricter than convenience.

- TypeScript stays `strict` and uses the strongest practical strictness flags.
- Raw type assertions are forbidden everywhere except `as const`.
- Use `satisfies`, explicit annotations, generics, type guards, discriminated unions, and Effect Schema instead of casts.
- Use `@total-typescript/shoehorn` only in tests, and only when a test needs partial mocks or intentionally invalid inputs.
- Never use `any`, `as unknown as`, `as never`, handler casts, `Record<string, unknown>` casts, or `// SAFETY:` comments.
- Runtime inputs must be validated at boundaries with shared Effect Schema helpers from `src/shared/schema.ts` and schemas under `src/shared/schemas/`.
- Do not use silent parse fallbacks. Log structured context or surface a visible error path.

Mechanical enforcement:

- Oxlint's `typescript/consistent-type-assertions` bans raw assertions while allowing `as const`.
- Oxlint's tsgolint-powered, type-aware `typescript/no-unsafe-*` rules catch unsafe flow from dependencies; intentional test and boundary exceptions stay narrowly scoped in `oxlint.config.mts`.
- `openwaggle/no-shoehorn-outside-tests` keeps Shoehorn test-only.
- The lint config (`oxlint.config.mts`, run by `bun lint` with oxlint as the fallback runner) bans explicit `any`, non-null assertions, unsafe patterns, and every inline lint directive (`eslint-disable*`, `oxlint-disable*`, `/* eslint */`, `/* global */`): fix the code or change the shared config, never the line.

## ts-match

OpenWaggle prefers `@diegogbrisa/ts-match` when pattern matching, exhaustive union handling, runtime guards, or boundary assertions improve clarity or type safety.

Before writing manual multi-branch discriminant/shape logic, runtime shape guards, or boundary assertions, load `.agents/skills/ts-match/SKILL.md` and apply its guidance.

Keep plain TypeScript for simple guard clauses or binary predicates where `ts-match` would add noise.

## Main Process Architecture

Main process code follows hexagonal architecture.

- Domain: pure business logic. No Electron, Node fs/process, SQL, Pi SDK, or store imports.
- Ports: Effect service interfaces. No vendor SDKs or stores.
- Adapters: infrastructure and vendor code. OpenWaggle app Pi SDK imports stay under `src/main/adapters/pi/`; dedicated Pi packages may import Pi SDKs inside `packages/pi-*`.
- Application services: orchestration through ports. No direct stores, IPC, or Pi SDK imports.
- IPC handlers: transport only. Decode input, call application services, return DTOs.
- Stores: persistence implementation details behind ports/services.

Mechanical enforcement:

- `openwaggle/main-architecture-boundaries` enforces Pi isolation, domain purity, no provider registry, and store/application/IPC boundaries.
- `import/no-cycle` catches dependency cycles.

## Pi Runtime

OpenWaggle is a UI and product shell over Pi, not a parallel runtime.

- Keep Pi-native session, tool, provider, model, auth, thinking-level, and compaction semantics end-to-end.
- Translate Pi details only at adapter boundaries into OpenWaggle-owned DTOs.
- Do not add custom OpenWaggle tool/runtime layers unless implemented as explicit Pi-native extensions behind ports.
- Project resources follow `.openwaggle > .pi > .agents` precedence for skills, extensions, prompts, and themes.
- OpenWaggle project config is `.openwaggle/settings.json`; Pi settings live under the nested `pi` key.
- Portable Waggle policy belongs in `packages/waggle-core` without Pi/OpenWaggle/Electron imports; Pi-specific Waggle behavior belongs in `packages/pi-waggle`.

Load `.agents/skills/pi-integration/SKILL.md` before Pi adapter, session projection, provider/auth/model, resource loading, MCP adapter, or run orchestration work.

## Publishable Package Boundaries

OpenWaggle publishable packages must preserve their public contract boundaries.

- `packages/extension-sdk/**` must stay browser-safe. Do not import Electron, Node built-ins, Pi SDK packages, renderer stores, main-process services, or OpenWaggle app internals.
- `packages/waggle-core/**` must stay runtime-neutral reusable policy. Do not import Pi SDK packages, Electron, Node built-ins, renderer stores, or app services.
- `packages/extension-react/**` may depend on `@openwaggle/extension-sdk` and React peers, but must not import OpenWaggle renderer components, app CSS, Tailwind internals, Electron, or app services.
- `packages/pi-waggle/**` may import Pi SDK packages, but must not import Electron, renderer stores, or OpenWaggle app services.
- These import boundaries must be enforced by `bun run check:repository-standards`, not only by review.

## Electron Runtime

- Main-process environment access is centralized in `src/main/env.ts`.
- Child processes must use the appropriate env helper instead of spreading `process.env` directly.
- Native modules need separate Node and Electron rebuild paths.
- Packaged runtime behavior must be validated in packaged app builds when the bug only appears after packaging.
- Main process logging uses structured loggers, not raw `console.*` outside logger modules.
- Automated Electron runs must route OS-visible actions through the centralized automation policy. Repository checks reject unguarded window-show/focus, native-dialog, and external-application calls outside that boundary.

Load `.agents/skills/electron-runtime/SKILL.md` for child-process env, native ABI, packaging, CDP, or Electron runtime startup issues.

## Renderer

Detailed renderer architecture rules live in `docs/renderer-architecture.md`.

- React 19 and React Compiler are enabled; do not use `React.memo`, `React.FC`, or `forwardRef`.
- Use `useMemo`/`useCallback` only for semantic identity required by an external API, not render optimization.
- Prefer focused Zustand selectors and feature-owned hooks over prop-drilled controller objects.
- Renderer features live under `src/renderer/src/features/<feature>/` with public indexes for cross-feature imports.
- Shared renderer primitives live under `src/renderer/src/shared/` and `src/renderer/src/shell/`.
- Use the shared UI primitives instead of raw renderer buttons except inside primitive implementations.
- Route-adjacent TanStack Router test files need the configured ignored filename pattern.

Mechanical enforcement:

- `openwaggle/renderer-import-boundaries` enforces feature boundaries.
- `openwaggle/no-raw-renderer-buttons` enforces shared button usage.
- `openwaggle/renderer-design-token-guardrails` rejects arbitrary snapped-family values, raw renderer hex colors, and Tailwind palette colors. Its binary per-file exemption list can only shrink.
- `openwaggle/jsx-max-props` discourages prop-drilled components.
- React Doctor catches React Compiler and renderer anti-patterns.

## Testing

- Unit, integration, and component tests live in nearby `__tests__/` folders.
- Tests should verify behavior through public interfaces.
- Use typed builders, `satisfies`, and Shoehorn test helpers instead of casts.
- Mock setup must avoid hoisting races; dynamically import subject modules after `vi.mock(...)` setup when needed.

Mechanical enforcement:

- `openwaggle/test-colocation` rejects loose non-E2E test files under `src/`.
- Vitest configs split unit, integration, component, and coverage runs.

## Tooling And Style

- Use TypeScript for project tooling when supported.
- Do not add JavaScript config/tooling files when a TypeScript equivalent is practical.
- Do not add TypeScript `baseUrl`; use explicit `paths` entries.
- Avoid inline `import()` types in source files; import types at the top.
- Use `while (true)`, not `for (;;)`.
- Use named `SCREAMING_SNAKE_CASE` constants for numeric literals outside tests.
- Do not add `eslint-disable`, `oxlint-disable`, or `fallow-ignore` comments to bypass architecture/style gates.
- A skill copied from another repository is pinned in `skills-lock.json` (upstream repository, path, commit, content hash). Record an edit to it, with the reason, through `bun scripts/skills-lock.ts record <skill> --reason "<why>"`; `bun scripts/skills-lock.ts drift` reports upstream changes on demand and needs the network.
- ADR numbers are unique and contiguous. A new ADR takes the next free number and is listed in the ADR index in `docs/architecture.md`.

Mechanical enforcement:

- The OpenWaggle lint plugin (`scripts/oxlint/`) catches inline import types, `for (;;)`, raw renderer buttons, lint directive and architecture bypass comments, and inline magic numbers; `bun run check:repository-standards` catches raw `<button>` in website Astro templates.
- oxfmt (`.oxfmtrc.json`) formats JavaScript and TypeScript: single quotes, no semicolons, trailing commas, width 100.
- `bun run check:repository-standards` catches repository standards drift, including vendored skills that differ from `skills-lock.json` without a recorded reason, skill directories the lock does not list, and ADR numbers that repeat, leave a gap or are missing from the ADR index. The ADR numbers that two ADRs already shared are frozen in `scripts/standards/adr-numbering.ts`; that list never grows.
