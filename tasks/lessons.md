# Lessons

User corrections and behavioral rules. Updated whenever the user corrects the agent. These are patterns to never repeat.

## Active Rules

- **Never type-cast** — use Zod validation or construct values that satisfy the type structurally. If a type is a discriminated union, construct a value matching the specific variant's interface. `as Foo` and `as unknown as Foo` are never acceptable.
