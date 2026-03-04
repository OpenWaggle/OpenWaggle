# Lessons

User corrections and behavioral rules. Updated whenever the user corrects the agent. These are patterns to never repeat.

## Active Rules

- Scope fidelity first: when the user asks for a targeted UI change (for example remove one icon), preserve all other behavior/layout unless explicitly asked to redesign more.
- Magic-number policy is strict when requested repository-wide: replace all inline numeric literals (including UI/layout values) with named `SCREAMING_SNAKE_CASE` constants, and keep `pnpm check:magic-numbers` green before handoff.
- DRY constant design preference: when the same numeric constant appears across files, centralize it in a shared constants module and group related constants into domain objects when that improves clarity.
- Script runtime preference: prefer TypeScript scripts (`.ts`) executed with `tsx` over `.mjs` scripts when adding or updating project scripts.
- **Never type-cast** — `as Foo`, `as unknown as Foo`, and `as Record<string, unknown>` are never acceptable. Instead, always use the proper TypeScript/Zod primitives to achieve type safety from top to bottom:
  - **Union types & discriminated unions** — model data variants with `type` discriminators, not casts after runtime checks.
  - **Zod v4 validation** — `.parse()` / `.safeParse()` at runtime boundaries (JSON.parse, IPC, external APIs). Use `.catch(defaultValue)` for graceful degradation, not `z.unknown()` which defeats validation. Centralize schemas in `src/shared/schemas/validation.ts`.
  - **`as const`** — use freely for literal type narrowing and tuple inference.
  - **Proper types & interfaces** — define explicit types and interfaces for all data shapes. Use explicit type annotations for mutable state (`const x: { used: boolean } = { used: false }`) instead of `false as boolean`.
  - **Generic functions** — use generics to propagate types through function boundaries instead of casting return values.
  - **Type inference top-to-bottom** — let TypeScript infer from Zod schemas (`z.infer<typeof schema>`), function return types, and generic parameters. If inference doesn't reach a consumer, fix the type chain — don't cast at the consumer.
  - **Type guards** — use `function isFoo(x: unknown): x is Foo` for narrowing, not casts after manual checks.
- **`// SAFETY:` comments are NEVER allowed** — they rationalize casts instead of fixing them. If a cast exists, the code needs a proper structural fix (type guard, generic, discriminated union, Zod validation). No exceptions.
- **Use Zod v4 API** — `.loose()` not `.passthrough()`, `z.globalRegistry` not `z.getSchema()`. Reference `.openwaggle/skills/zod-v4/SKILL.md`.
- **Skill creation workflow is mandatory** — when creating or updating any skill, always load and follow the `skill-creator` skill first. Treat this as a hard requirement, not optional guidance.
- **Skill location support must be comprehensive** — when applying `skill-creator` outputs, create skills under the corresponding `skills` subfolder (`.openwaggle/skills/`, `.claude/skills/`, `.codex/skills/`) as requested by the user.
- **Never unstage/revert unknown work** — do not unstage, reset, checkout, or otherwise undo any existing unstaged/staged changes that were not explicitly implemented by this agent in the current turn, because they may belong to another agent's in-progress work.
- **Avoid explicit `Record<string, unknown>` annotations when inference can express the same shape** — prefer structurally inferred objects (for example via `Object.fromEntries`) unless a named interface is truly required.
- **React component architecture preference (user-required)** — avoid pass-through wrapper components and prop-drilling-heavy composition for app-level UI. Prefer components that self-wire via focused Zustand/hooks, and keep parent components for layout composition only when they add real layout behavior.
- **Avoid mega controller props in split components** — do not pass large controller objects (or many forwarded props) through section boundaries. Decompose controller logic into focused hooks/selectors consumed directly inside each feature section.
- **Always acknowledge user messages** — when the user sends information (summaries, FYIs, context), always explicitly acknowledge it before or during related work. Never silently consume user-provided context without responding. Ignoring a user message is disrespectful regardless of how busy you are with a task.
- **Don't prematurely optimize** — don't add throttling, debouncing, or caching mechanisms unless there's a demonstrated performance problem. ReactMarkdown handles typical LLM streaming rates (~20-50 tokens/sec) without jank. Optimize when you measure a problem, not when you imagine one.
- **Never let Composer API drift crash the composer UI** — renderer features that depend on newly added preload methods must feature-detect runtime availability (`typeof api.method === 'function'`) and gracefully degrade with local inline errors/toasts. Do not allow a missing method to throw and trigger `Composer panel error` fallback that removes the composer interaction surface.
- **Do not render auto-converted long-prompt attachments as inline text previews in chat messages** — for generated `Pasted Text *.md` attachments, show file-only attachment labels in transcript previews. Rendering clipped content (`...`) makes users think the message was truncated/sent inline and degrades trust in attachment upload UX.
- **Do not silently swallow async failures** — if a promise rejection is intentionally absorbed for control-flow/cleanup reasons, always log structured context (component/feature + actionable error message) so failures remain diagnosable.
