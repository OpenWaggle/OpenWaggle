---
name: migrate-to-shoehorn
description: Use @total-typescript/shoehorn for test-only partial mocks or intentionally invalid inputs. Use when writing tests, refactoring tests, or removing raw `as` casts from test fixtures.
---

# Migrate To Shoehorn

Use Shoehorn as a test-only escape hatch. It improves test ergonomics over raw casts, but production code must model types directly instead.

This is not a one-time migration-only skill. Keep using it whenever tests need partial fixtures, intentionally invalid inputs, or cleanup of raw assertions. Once a specific area is migrated, the skill remains valid as guidance for future test fixture work.

## Rules

- Use only in test files.
- Never import `@total-typescript/shoehorn` from production source.
- Prefer typed builders, narrower interfaces, `satisfies`, type guards, or schema decoding first.
- Use `fromPartial()` for partial mocks that still match the relevant shape.
- Use `fromAny()` only for tests that intentionally pass invalid data.
- Use `fromExact()` when a test should provide the full target type.

## Install

OpenWaggle pins dependencies. Use pnpm and an explicit version:

```bash
pnpm add -D @total-typescript/shoehorn@0.1.2
```

## Migration Patterns

Raw cast to partial mock:

```ts
import { fromPartial } from '@total-typescript/shoehorn'

handler(fromPartial({ body: { id: '123' } }))
```

Double cast to intentionally invalid data:

```ts
import { fromAny } from '@total-typescript/shoehorn'

expect(() => handler(fromAny({ body: { id: 123 } }))).toThrow()
```

Full object requirement:

```ts
import { fromExact } from '@total-typescript/shoehorn'

handler(fromExact({ body: { id: '123' }, headers: {}, cookies: {} }))
```

## Workflow

1. Find raw assertions in tests.
2. Replace partial valid objects with `fromPartial()`.
3. Replace intentionally wrong data with `fromAny()`.
4. Replace full fixture assertions with explicit typed objects or `fromExact()`.
5. Run `pnpm typecheck`, `pnpm lint`, and relevant tests.
