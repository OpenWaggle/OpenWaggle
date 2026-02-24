# Lessons

User corrections and behavioral rules. Updated whenever the user corrects the agent. These are patterns to never repeat.

## Active Rules

- **Never type-cast** — always validate and infer types top-to-bottom. Use Zod schemas (`.parse()` / `.safeParse()`) for runtime boundaries (JSON.parse results, IPC payloads, external data). For discriminated unions, construct values matching the specific variant's interface. `as Foo`, `as unknown as Foo`, and `as Record<string, unknown>` are never acceptable — if you need a `Record<string, unknown>`, validate with `z.record(z.unknown())`.
