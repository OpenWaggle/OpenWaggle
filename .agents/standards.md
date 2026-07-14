# OpenWaggle Agent Standards

Centralized repository standards for AI coding agents. Root `AGENTS.md` is the entrypoint; this file carries the durable details.

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

- `@typescript-eslint/consistent-type-assertions` bans raw assertions while allowing `as const`.
- Type-aware `@typescript-eslint/no-unsafe-*` rules catch unsafe flow from dependencies and tests.
- `openwaggle/no-shoehorn-outside-tests` keeps Shoehorn test-only.
- Biome and ESLint ban explicit `any`, non-null assertions, disabled lint comments, and unsafe patterns.

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
- These import boundaries must be enforced by `pnpm check:repository-standards`, not only by review.

## Electron Runtime

- Main-process environment access is centralized in `src/main/env.ts`.
- Child processes must use the appropriate env helper instead of spreading `process.env` directly.
- Native modules need separate Node and Electron rebuild paths.
- Packaged runtime behavior must be validated in packaged app builds when the bug only appears after packaging.
- Main process logging uses structured loggers, not raw `console.*` outside logger modules.

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
- `openwaggle/jsx-max-props` discourages prop-drilled components.
- React Doctor catches React Compiler and renderer anti-patterns.

## Testing

- Unit, integration, and component tests live in nearby `__tests__/` folders.
- E2E tests live under `e2e/`.
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
- Do not add `eslint-disable`, `biome-ignore`, or `fallow-ignore` comments to bypass architecture/style gates.

Mechanical enforcement:

- OpenWaggle ESLint rules catch inline import types, `for (;;)`, raw website/renderer buttons, architecture bypass comments, and inline magic numbers.
- `pnpm check:repository-standards` catches repository standards drift.
