---
name: zod-v4
description: Zod v4 API changes and migration patterns from v3
---

# zod-v4

## Overview

This skill documents the Zod v4 API surface, breaking changes from v3, and migration patterns. Use it whenever writing or reviewing Zod schemas to ensure v4 idioms are used instead of deprecated v3 patterns.

## When To Use

- Writing new Zod schemas anywhere in the codebase.
- Reviewing code that uses Zod for v3 leftovers.
- Migrating existing v3 schemas to v4.
- Debugging unexpected Zod validation behavior after upgrading.

## Import Paths

```ts
// Zod v4 (primary — package root now exports v4)
import { z } from "zod";

// Explicit v4 subpath (permanent permalink)
import { z } from "zod/v4";

// Zod Mini (smaller bundle, check-based API)
import { z } from "zod/v4-mini";

// Core (for library authors building on Zod internals)
import { z } from "zod/v4/core";
```

The `"zod/v4"` and `"zod/v4-mini"` subpaths are permanent and will remain available forever.

---

## 1. Deprecated / Removed / Renamed

### Object Mode Methods

| v3 (deprecated)                          | v4 (preferred)                      |
| ---------------------------------------- | ----------------------------------- |
| `z.object({...}).passthrough()`          | `z.looseObject({...})`              |
| `z.object({...}).strict()`               | `z.strictObject({...})`             |
| `.nonstrict()` (alias for `.strip()`)    | Removed entirely                    |
| `.merge()` on ZodObject                  | Deprecated; use spread + `z.object` |

The `.passthrough()` and `.strict()` methods still exist for backward compatibility but are considered legacy. Prefer the top-level factory functions.

### String Format Methods

All string format validators are now **top-level functions**. The method equivalents are deprecated and will be removed in the next major version.

| v3 (deprecated)            | v4 (preferred)         |
| -------------------------- | ---------------------- |
| `z.string().email()`       | `z.email()`            |
| `z.string().uuid()`        | `z.uuidv4()`           |
| `z.string().url()`         | `z.url()`              |
| `z.string().ip()`          | `z.ipv4()` / `z.ipv6()`|
| `z.string().base64()`      | `z.base64()`           |

Additional top-level string formats: `z.uuidv7()`, `z.uuidv8()`, `z.cidrv4()`, `z.cidrv6()`, `z.e164()`, `z.base64url()`, `z.jwt()`, `z.lowercase()`.

### ISO Date/Time Formats

| v3 (deprecated)              | v4 (preferred)        |
| ---------------------------- | --------------------- |
| `z.string().datetime()`      | `z.iso.datetime()`    |
| `z.string().date()`          | `z.iso.date()`        |
| `z.string().time()`          | `z.iso.time()`        |
| (none)                       | `z.iso.duration()`    |

### Error Customization Parameters

| v3 (deprecated)                                 | v4 (preferred)                       |
| ----------------------------------------------- | ------------------------------------ |
| `z.string({ message: "Bad" })`                  | `z.string({ error: "Bad" })`        |
| `z.string({ invalid_type_error: "..." })`       | Removed; use `error` param           |
| `z.string({ required_error: "..." })`           | Removed; use `error` param           |

The `message` param still works but is deprecated. The `error` param optionally accepts a function for dynamic messages.

### Enum Changes

| v3 (deprecated)                   | v4 (preferred)                              |
| --------------------------------- | ------------------------------------------- |
| `z.nativeEnum(MyEnum)`            | `z.enum(MyEnum)` (overloaded to accept enums)|
| `ColorSchema.Enum`                | Removed                                     |
| `ColorSchema.Values`              | Removed                                     |

### ZodError Property

| v3                                    | v4                                                |
| ------------------------------------- | ------------------------------------------------- |
| `error.errors` (array of issues)      | `error.issues` (canonical; `.errors` is legacy)   |
| `error.message` (JSON-stringified)    | `error.message` is a human-readable string        |

### Internal Access

| v3                  | v4                     |
| ------------------- | ---------------------- |
| `schema._def`       | `schema._zod.def`     |

### Removed Utility Types / Exports

Many quasi-internal types that v3 exported (e.g. intermediate issue types, internal class generics) have been reorganized into `zod/v4/core` under the `z.core` namespace. If you previously imported internal types directly, check `z.core.*` or `zod/v4/core`.

---

## 2. New API Surface

### Numeric Format Schemas

```ts
z.int()       // integer in [MIN_SAFE_INTEGER, MAX_SAFE_INTEGER]
z.int32()     // integer in [-2147483648, 2147483647]
z.uint32()    // integer in [0, 4294967295]
z.float32()   // float in [-3.4e38, 3.4e38]
z.float64()   // float in [-1.8e308, 1.8e308]

// BigInt variants
z.int64()     // bigint
z.uint64()    // bigint
```

### Template Literals

```ts
const px = z.templateLiteral(z.number(), z.literal("px"));
// matches "42px", "3.14px", etc.
```

### Object Variants

```ts
z.looseObject({ name: z.string() })   // allows unknown keys (passthrough)
z.strictObject({ name: z.string() })  // rejects unknown keys
```

### `.safeExtend()`

```ts
// .extend() throws on schemas with refinements; use .safeExtend() instead
const extended = baseSchema.safeExtend({ newField: z.string() });
```

### `.overwrite()`

Represents transforms that do not change the inferred type. Returns an instance of the original class (not ZodPipe).

```ts
const trimmed = z.string().overwrite((s) => s.trim());
// typeof trimmed is still ZodString, not ZodPipe
```

The existing `.trim()`, `.toLowerCase()`, `.toUpperCase()` methods are reimplemented using `.overwrite()` internally.

### Checks (Generalized Refinements)

Each schema contains an array of "checks" that generalize the concept of a refinement to include potentially side-effectful transforms.

```ts
// In Zod Mini, use .check() with standalone check functions:
z.string().check(z.minLength(5), z.maxLength(10), z.trim());
```

Available check functions: `z.minLength()`, `z.maxLength()`, `z.lowercase()`, `z.uppercase()`, `z.normalize()`, `z.trim()`, `z.toLowerCase()`, `z.toUpperCase()`, `z.overwrite()`, `z.refine()`.

### `z.literal()` with Multiple Values

```ts
z.literal("a", "b", "c")  // union of literal types
```

### `z.partialRecord()`

```ts
// When using enum keys with z.record(), v4 enforces exhaustiveness.
// To get the old v3 partial behavior:
z.partialRecord(z.enum(["a", "b", "c"]), z.number());
// => { a?: number; b?: number; c?: number }
```

### Metadata and Registries

```ts
// Create a typed registry
const myRegistry = z.registry<{ description: string }>();
myRegistry.add(schema, { description: "A user schema" });
myRegistry.get(schema);  // { description: "A user schema" }
myRegistry.has(schema);  // true
myRegistry.remove(schema);

// Global registry (JSON Schema compatible metadata)
z.globalRegistry.add(schema, { id: "User", title: "User", description: "..." });

// .describe() is shorthand for globalRegistry registration
z.string().describe("A name");

// .meta() associates metadata with a schema
z.string().meta({ title: "Name", description: "User's name" });
```

Metadata is stored in the registry, not inside the schema instance. Zod methods are immutable and return new instances, so metadata is associated with the specific instance it was registered on.

### JSON Schema Conversion

```ts
import { z } from "zod/v4";

z.toJSONSchema(schema);       // schema -> JSON Schema
z.fromJSONSchema(jsonSchema);  // JSON Schema -> Zod schema
```

Supports JSON Schema `draft-2020-12`, `draft-7`, `draft-4`, and OpenAPI 3.0.

---

## 3. Changed Behavior

### Refinements Architecture

In v3, both refinements and transformations lived inside a `ZodEffects` wrapper class. In v4:
- **Refinements** live inside the schemas themselves as "checks".
- **Transforms** live in a dedicated `ZodTransform` class.
- `.transform()` returns a `ZodPipe` instance (not `ZodEffects`).
- `z.preprocess()` now returns a `ZodPipe` containing a `ZodTransform` and the inner schema.

### `.pick()` / `.omit()` Strip Refinements

In v4, `.pick()` and `.omit()` intentionally strip all custom validation checks (`.check()`, `.refine()`). This is a breaking change from v3 where the type system prevented chaining `.refine(...).pick(...)`. The rationale is that refinements may reference fields that no longer exist after pick/omit.

### `.extend()` Throws on Refined Schemas

Calling `.extend()` on a schema that has refinements will throw. Use `.safeExtend()` instead.

### `z.record()` with Enum Keys is Exhaustive

```ts
const MyEnum = z.enum(["a", "b", "c"]);

// v3: { a?: number; b?: number; c?: number }  (partial)
// v4: { a: number; b: number; c: number }      (exhaustive)
z.record(MyEnum, z.number());

// To get v3 behavior:
z.partialRecord(MyEnum, z.number());
```

### Numeric Keys in Records (v4.2+)

Number schemas used as record keys validate that the key is a valid numeric string, and numerical constraints (`min`, `max`, `step`, etc.) are enforced.

### Defaults Applied Inside Optional Fields

In v4, defaults inside optional properties are now applied during parsing. This aligns with developer expectations and resolves a long-standing v3 usability issue.

### Discriminated Unions

`z.discriminatedUnion()` now supports:
- Unions as members (composable discriminated unions)
- Pipes as members
- Nesting one discriminated union inside another

### ZodType Generic Structure

The `ZodType` base class generic structure changed:
- v3: `ZodType<Output, Def, Input>` (3 generics)
- v4: `ZodType<Output, Input>` (2 generics; `Def` removed)
- The `Input` generic now defaults to `unknown` instead of defaulting to `Output`.

### `z.infer`, `z.input`, `z.output`

These utility types still work the same way but reflect the new 2-generic base class:

```ts
type UserOutput = z.infer<typeof userSchema>;   // output type
type UserInput  = z.input<typeof userSchema>;    // input type
type UserOutput = z.output<typeof userSchema>;   // same as z.infer
```

---

## 4. Performance

- **Type instantiations**: Compiling with `zod/v3` produces >25,000 type instantiations; `zod/v4` produces ~175.
- **Runtime**: Object `safeParse` is ~6.5x faster than v3.
- **Bundle**: Core bundle is ~57% smaller (2.3x reduction).
- **String formats as top-level functions** are more tree-shakable.

---

## 5. Migration Patterns

### Pattern: Object with passthrough

```ts
// v3
const schema = z.object({ name: z.string() }).passthrough();

// v4
const schema = z.looseObject({ name: z.string() });
```

### Pattern: String validation

```ts
// v3
const email = z.string().email({ message: "Invalid email" });

// v4
const email = z.email({ error: "Invalid email" });
```

### Pattern: Native enum

```ts
// v3
enum Color { Red, Blue }
const schema = z.nativeEnum(Color);

// v4
enum Color { Red, Blue }
const schema = z.enum(Color);
```

### Pattern: Error customization

```ts
// v3
z.string({ invalid_type_error: "Must be string", required_error: "Required" });

// v4
z.string({ error: "Must be a string" });
// Or with a function for dynamic messages:
z.string({ error: (issue) => `Expected string, got ${typeof issue.input}` });
```

### Pattern: Accessing internals

```ts
// v3
schema._def.typeName

// v4
schema._zod.def
```

### Pattern: Extending refined schemas

```ts
// v3 — .extend() after .refine() caused type errors (ZodEffects)
// v4 — .extend() throws at runtime; use .safeExtend()
const base = z.object({ a: z.string() }).refine((d) => d.a.length > 0);
const extended = base.safeExtend({ b: z.number() });
```

### Pattern: Record with enum keys (partial)

```ts
// v3 — z.record(enumSchema, valueSchema) was partial
// v4 — z.record() with enum keys is now exhaustive
z.partialRecord(z.enum(["a", "b"]), z.string()); // v3-equivalent partial behavior
```

### Pattern: Describe / metadata

```ts
// v3 — .describe() stored metadata inside the schema
const s = z.string().describe("A name");

// v4 — .describe() registers in z.globalRegistry (external to schema)
const s = z.string().describe("A name");
// For richer metadata:
const s = z.string().meta({ title: "Name", description: "User's name" });
```

---

## Guardrails

- Never use `.passthrough()` or `.strict()` on new code; use `z.looseObject()` / `z.strictObject()`.
- Never use `z.string().email()` or similar method validators; use top-level `z.email()`, `z.url()`, etc.
- Never use `z.nativeEnum()`; use `z.enum()` which now accepts TypeScript enums.
- Never use `message` / `invalid_type_error` / `required_error` params; use `error`.
- Never use `.extend()` on schemas with refinements; use `.safeExtend()`.
- Never access `schema._def`; use `schema._zod.def`.
- When using `z.record()` with enum keys, be aware it is now exhaustive. Use `z.partialRecord()` for optional keys.
- Prefer `error.issues` over `error.errors` for accessing ZodError issue arrays.
