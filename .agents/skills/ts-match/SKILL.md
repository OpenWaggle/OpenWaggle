---
name: ts-match
description: This skill should be used when an agent is writing or reviewing TypeScript code that uses ts-match (published as @diegogbrisa/ts-match) for pattern matching, exhaustive discriminated-union handling, promise-aware branching, runtime validation, grouped cases, pattern helpers, or boundary assertions.
---

# ts-match usage skill

## What the library is for

ts-match is a TypeScript-first pattern matching library with strong handler inference, exhaustive handling of closed unions, promise-aware terminals, runtime validation helpers, grouped discriminant cases, and zero runtime dependencies. Install and import it as `@diegogbrisa/ts-match`.

Use ts-match when code benefits from:

- exhaustive closed-union handling;
- narrowed handler parameters without casts;
- structural object/tuple/array/record matching;
- reusable runtime validators at boundaries;
- promise-backed inputs with one normalized terminal promise;
- discriminant/path dispatch through `matchBy`.

Keep simple `if` conditions when a normal condition is clearer.

## Primary public APIs

- `match(value)` — synchronous structural/value pattern matching.
- `match.promise(valueOrPromise)` — promise-aware structural/value matching. Resolves values, promises, thenables, and `PromiseLike` inputs internally; handlers receive `Awaited<TInput>`.
- `matchBy(value, path)` — synchronous discriminant/path matching. Handlers receive the full narrowed input value.
- `matchBy.promise(valueOrPromise, path)` — promise-aware discriminant/path matching. Paths, tags, maps, groups, and handlers infer from `Awaited<TInput>`.
- `P` — namespace of reusable pattern helpers.
- Named `p*` helpers — focused named exports equivalent to `P.*` helpers.
- `group(...)` — reusable grouped `matchBy` case entry helper.
- `isMatching(pattern, value)` / `isMatching(pattern)(value)` — runtime type guards.
- `assertMatching(pattern, value)` — boundary assertion that throws `PatternMismatchError` on mismatch.
- `NonExhaustiveMatchError`, `PatternMismatchError` — public error classes.
- `MatchPromiseResult<T>` — safe promise terminal result: `{ ok: true; value: T } | { ok: false; error: unknown }`.

## Hard rules for agents

- Import only public APIs from `@diegogbrisa/ts-match` or documented package subpaths.
- Never import from `src`, `dist`, or internal files in user code.
- Do not invent helpers. Use only APIs listed here or in the README.
- Prefer chained `.with(...).exhaustive()` for closed unions in normal application code.
- Use variadic `.with(pattern1, pattern2, handler)` or `.with(tag1, tag2, handler)` as the default way to share one handler across a small number of equivalent patterns/tags.
- Do not convert an otherwise simple `.with(...)` chain to `.cases((group) => [...])` just because one branch has shared tags.
- Use `.otherwise(...)` only when fallback behavior is intentional.
- Use `match.promise(...)` or `matchBy.promise(...)` primarily when the matched input itself is promise-backed or may be promise-backed. Promise builders resolve the input internally; handlers receive `Awaited<TInput>`.
- Do not choose promise builders merely because branch handlers are async. If the input is already resolved, use plain `match(...)` or `matchBy(...)`; awaiting the terminal result is fine when handlers return promises.
- Do not use unsafe TypeScript casts. Do not add const assertions to inline ts-match arrays just to make inference work.
- Do not use broad `any` in examples or generated code.
- Keep examples real and inference-first: no fake `const input: unknown = ...`, no direct `JSON.parse(...)` typed as trusted data, no assertion-style endings, and no return/result annotations unless they are genuinely needed.
- Do not add wrapper functions just to prove an API; use a small app case where the function would naturally exist.
- Do not use `switch` in generated examples unless explicitly writing a short before/after comparison requested by the user.
- Avoid inline object-map `.cases({...})` in hot loops. Prefer `.with(...).exhaustive()` unless the user explicitly accepts the manual-typing tradeoff of hoisted case maps.
- When TypeScript reports a `ts-match:` diagnostic, read that payload first and fix the modeled issue. Do not silence it with casts, `any`, or a rewrite to `switch`.

## Valid imports

Root import for normal usage:

```ts
import { assertMatching, group, isMatching, match, matchBy, P } from '@diegogbrisa/ts-match'
import type { MatchByPath, MatchedValue, MatchPromiseResult } from '@diegogbrisa/ts-match'
```

Focused subpaths:

```ts
import { match } from '@diegogbrisa/ts-match/match'
import { matchBy } from '@diegogbrisa/ts-match/match-by'
import { P, pString } from '@diegogbrisa/ts-match/patterns'
import { isMatching, assertMatching } from '@diegogbrisa/ts-match/assertions'
import { NonExhaustiveMatchError, PatternMismatchError } from '@diegogbrisa/ts-match/errors'
import { group } from '@diegogbrisa/ts-match/group'
```

There is no default export.

### Focused subpath type exports

Use these only when accepting/forwarding builders or writing library integrations. Most application code should rely on inference.

- `@diegogbrisa/ts-match/match`: `match`, `SyncMatchBuilder`, `PromiseMatchBuilder`, `MatchFunction`, `MatchedValue`, `MatchPromiseResult`.
- `@diegogbrisa/ts-match/match-by`: `matchBy`, `SyncMatchByBuilder`, `PromiseMatchByBuilder`, `MatchByBuilder`, `MatchByFunction`, `MatchByPath`, `MatchPromiseResult`.
- `@diegogbrisa/ts-match/patterns`: `P` and every public `p*` helper.
- `@diegogbrisa/ts-match/assertions`: `isMatching`, `assertMatching`.
- `@diegogbrisa/ts-match/errors`: `NonExhaustiveMatchError`, `PatternMismatchError`, `preview`, `MatchErrorMetadata`.
- `@diegogbrisa/ts-match/group`: `group`.

## Choosing the right matcher

Use `matchBy` when one key/path decides a discriminated union branch:

```ts
const next = matchBy(action, 'type')
  .with('start', (action) => startState(action.id))
  .with('success', (action) => readyState(action.rows))
  .with('failure', (action) => failedState(action.message))
  .exhaustive()
```

Use `match` when matching structure, tuples, arrays, predicates, selections, records, exact objects, or non-discriminant values:

```ts
const displayName = match(profile)
  .with({ type: 'user', profile: { name: P.select('name', P.string) } }, ({ name }) => name)
  .with({ type: 'team', name: P.select('name', P.string) }, ({ name }) => name)
  .otherwise(() => 'Guest')
```

Use promise builders when the input itself may be async. Pass the promise-producing expression directly so the builder resolves it and matches the resolved value:

```ts
const status = await matchBy
  .promise(fetchOrder('order-1'), 'state')
  .with('paid', (order) => ({ type: 'readyToShip', orderId: order.id }))
  .otherwise(() => ({ type: 'needsReview' }))
```

Use plain `match(...)` / `matchBy(...)` when the input is already resolved, even if one or more handlers return promises. Use sync `match(promise)` only if you intentionally want to match the `Promise` object itself.

## `match(value)` use cases

### Literal and structural branches

```ts
const label = match(status)
  .with('ready', () => 'Ready')
  .with(0, () => 'No items')
  .with({ ok: true }, (value) => value.body)
  .otherwise(() => 'Needs attention')
```

Plain literals, object patterns, bare tuple arrays, and every `P.*` helper are valid patterns. Literal equality uses `Object.is`.

### Multiple patterns sharing one handler

```ts
const status = match(state)
  .with('idle', 'loading', () => 'pending')
  .with('success', () => 'done')
  .exhaustive()
```

### `.when(predicate, handler)`

Use `.when(...)` for value-level predicates that are easier to express as functions:

```ts
function discountLabel(percent: number) {
  return match(percent)
    .when(
      (value) => value > 0,
      (value) => `${String(value)}% off`,
    )
    .otherwise(() => 'No discount')
}
```

Use `P.when(predicate)` when the predicate should be nested inside another pattern.

### `.otherwise(handler)`

Use `.otherwise(...)` for open inputs or intentional fallback behavior. The fallback receives the remaining unmatched value type.

```ts
const size = match(value)
  .with(P.string, (value) => value.length)
  .otherwise(() => 0)
```

### `.exhaustive()`

Use `.exhaustive()` for closed unions. TypeScript rejects it while known cases remain unhandled.

```ts
const text = match(result)
  .with({ type: 'success' }, (value) => value.data)
  .with({ type: 'error' }, (value) => value.message)
  .with({ type: 'idle' }, () => 'idle')
  .exhaustive()
```

At runtime, unexpected unhandled data throws `NonExhaustiveMatchError`.

### Selections

No `P.select`: handler receives the matched value.

```ts
match(user).with({ type: 'user' }, (user) => user.id)
```

One anonymous `P.select()`: handler receives the selected value.

```ts
match(user).with({ profile: { name: P.select() } }, (name) => name)
```

Named selections: handler receives an object of selected values.

```ts
match(user).with(
  { name: P.select('name', P.string), age: P.select('age', P.number) },
  ({ name, age }) => `${name}:${age}`,
)
```

Do not mix anonymous and named selections in one successful pattern.

### Rendering UI from typed data

Use JSX examples when they make the pattern more visual: a match expression returns the selected handler's value, so branches can return components. Keep the scenario generic and self-contained.

```tsx
import { match, P } from '@diegogbrisa/ts-match'

type ProductContent = { type: 'text'; body: string } | { type: 'image'; src: string; alt: string }

type ProductResult =
  | { status: 'loading' }
  | { status: 'success'; product: { title: string; content: ProductContent } }
  | { status: 'error'; error: Error }

function ProductPreview({ result }: { result: ProductResult }) {
  return match(result)
    .with({ status: 'loading' }, () => <p>Loading product…</p>)
    .with({ status: 'error' }, ({ error }) => <p role="alert">{error.message}</p>)
    .with({ status: 'success', product: { content: { type: 'text' } } }, ({ product }) => (
      <article>
        <h2>{product.title}</h2>
        <p>{product.content.body}</p>
      </article>
    ))
    .with(
      { status: 'success', product: { content: { type: 'image', src: P.select('src'), alt: P.select('alt') } } },
      ({ src, alt }) => <img src={src} alt={alt} />,
    )
    .exhaustive()
}
```

React is only an example consumer; do not imply `ts-match` depends on React. Prefer generic UI states such as products, checkout, onboarding, routes, forms, or API results over one app's private domain.

## `match.promise(valueOrPromise)` use cases

Promise builders are for promise-backed inputs. They accept `T | PromiseLike<T>`, including thenables, resolve the input internally, and pass `Awaited<TInput>` to handlers. Prefer passing the promise-producing expression directly instead of awaiting into a temporary value and then matching.

Do not use `match.promise(...)` solely because branch handlers return promises. If the matched value is already resolved, use `match(value)` and await the terminal result when needed.

```ts
type ProfileResponse =
  | { ok: true; profile: { id: string; name: string } }
  | { ok: false; status: number; message: string }

const profileResponse: ProfileResponse = { ok: true, profile: { id: 'user-1', name: 'Ada' } }
const missingProfile: ProfileResponse = { ok: false, status: 404, message: 'missing' }
const responses: readonly ProfileResponse[] = [profileResponse, missingProfile]
const profilePromise = Promise.resolve(responses[0] ?? missingProfile)

const name = await match
  .promise(profilePromise)
  .with({ ok: true, profile: { name: P.select('name', P.string) } }, ({ name }) => name)
  .with({ ok: false }, ({ message }) => message)
  .exhaustive()
```

Normal terminals reject for input rejection, pattern/predicate errors, handler throws/rejections, fallback throws/rejections, and defensive non-exhaustiveness. `.otherwise(...)` is only a pattern fallback; it does not catch input rejection.

### Promise normal terminals

```ts
const result = match
  .promise(profilePromise)
  .with({ ok: true }, (value) => value.profile.name)
  .with({ ok: false }, async (value) => value.message)
  .exhaustive()
```

Handler return values are awaited and unwrapped, so promise-returning and plain branches produce one terminal promise. This is supported behavior, but it is not by itself a reason to choose `match.promise(...)` over `match(...)` when the matched input is already resolved.

### Promise safe terminals

Safe terminals exist only on promise builders.

```ts
const missingProfile: ProfileResponse = { ok: false, status: 404, message: 'missing' }
const missingResponses: readonly ProfileResponse[] = [missingProfile]
const missingProfilePromise = Promise.resolve(missingResponses[0] ?? missingProfile)

const result = await match
  .promise(missingProfilePromise)
  .with({ ok: true, profile: { name: P.select('name', P.string) } }, ({ name }) => name)
  .safeOtherwise(() => 'Guest')

if (result.ok) {
  result.value
} else {
  result.error
}
```

- `safeExhaustive()` preserves compile-time exhaustiveness exactly like `.exhaustive()`.
- `safeOtherwise(handler)` requires a fallback handler; there is no no-argument form.
- Safe results have type `Promise<MatchPromiseResult<Output>>`.
- Safe success values are awaited before wrapping.
- Safe errors are `unknown` and are the original thrown/rejected reason when possible.

Use `safeExhaustive()` for closed unions where operational failures should be returned as values:

```ts
const result = await match
  .promise(profilePromise)
  .with({ ok: true }, (value) => value.profile.name)
  .with({ ok: false }, (value) => value.message)
  .safeExhaustive()
```

## `matchBy(value, path)` use cases

`matchBy` reads a direct key, nested dot path, or tuple path and dispatches by the selected tag. Handlers receive the full input value narrowed by the tag.

### Direct keys

```ts
const operation = matchBy(cartAction, 'type')
  .with('addItem', (action) => ({ type: 'lineItemAdded', sku: action.sku, quantity: action.quantity }))
  .with('applyCoupon', (action) => ({ type: 'discountApplied', code: action.code, multiplier: 0.9 }))
  .with('clearCart', (action) => ({ type: 'cartCleared', reason: action.reason }))
  .exhaustive()
```

### Nested dot paths and tuple paths

```ts
const label = matchBy(event, 'meta.type')
  .with('click', (event) => `click:${event.meta.x}`)
  .with('submit', (event) => `submit:${event.meta.form}`)
  .exhaustive()
```

Use tuple paths for symbol keys or literal path segments that contain dots:

```ts
const label = matchBy(event, ['meta', EVENT_KIND])
  .with('user', (event) => event.meta.name)
  .with('system', (event) => String(event.meta.code))
  .exhaustive()
```

Autocomplete suggests finite tag-like paths. Broad scalar paths such as arbitrary `string` or `number` fields remain accepted manually but are not suggested as primary discriminants.

### `.with(...tags, handler)`

Use chained `.with(...)` for normal application dispatch. One or more tags can share a handler, and variadic `.with(tag1, tag2, handler)` is the default grouping mechanism for simple same-handler cases.

```ts
const status = matchBy(event, 'type')
  .with('start', 'resume', (event) => `active:${event.id}`)
  .with('stop', (event) => `stopped:${event.reason}`)
  .exhaustive()
```

Keep one-to-one branches as one `.with(tag, handler)` each. Do not rewrite a readable `.with(...)` chain into `.cases((group) => [...])` only to use `group(...)` for one repeated handler.

### `.cases({...})` object maps

Use object maps for compact exhaustive maps when tags are representable as object keys and there are no normalized key collisions.

```ts
const auditEvent = matchBy(cartAction, 'type').cases({
  addItem: (action) => ({ category: 'inventory', sku: action.sku, quantity: action.quantity }),
  applyCoupon: (action) => ({ category: 'pricing', code: action.code, percentOff: action.percentOff }),
  clearCart: (action) => ({ category: 'lifecycle', reason: action.reason }),
})
```

Avoid object maps for `null`, `undefined`, or collisions like `1` and `'1'`; use tuple/grouped cases instead. Avoid bare `__proto__:` object-literal syntax because JavaScript treats it specially; use computed `['__proto__']`, tuple entries, or grouped cases when that tag matters.

### `.cases((group) => [...])` callback groups

Use callback groups when case-list syntax is materially clearer than chained `.with(...)`: many branches are grouped, cases are generated or reused, tuple/object entries are needed, or callback-local grouped inference is specifically needed. Do not use `group(tag, handler)` for ordinary one-to-one cases that read better as `.with(tag, handler)`.

```ts
const status = matchBy(event, 'type').cases((group) => [
  group('start', 'resume', (event) => `active:${event.id}`),
  group('stop', 'pause', (event) => `inactive:${event.reason}`),
  group('error', 'timeout', (event) => `error:${event.message}`),
])
```

This form supports single-tag groups, variadic multi-tag groups, and array-form groups. Prefer chained `.with(...)` when most entries would be single-tag groups.

### `.cases([...])` tuple/grouped entry arrays

Use entry arrays when cases are generated, need universal tag support, or are easier to read as tuples.

```ts
type State =
  | { kind: 'ready'; data: string }
  | { kind: 'failed'; reason: string }
  | { kind: null }
  | { kind?: undefined }

declare const state: State

const label = matchBy(state, 'kind').cases([
  ['ready', (state) => state.data],
  [[null, undefined], () => 'empty'],
  ['failed', (state) => state.reason],
])
```

Valid entries:

- `[tag, handler]`;
- `[[tag1, tag2], handler]`;
- `group(tag, handler)`;
- `group(tag1, tag2, ...moreTags, handler)`;
- `group(tags, handler)`.

Inline tuple-entry arrays contextually infer handlers from sibling tags. Partial grouped arrays preserve tag autocomplete while editing grouped tags. Exhaustive grouped `.cases([...])` keeps missing-case diagnostics active while the list is incomplete, so callback `.cases((group) => [group('a', 'b', handler)])` is the best autocomplete shape for exhaustive grouped cases. Broad runtime arrays are runtime-valid but do not prove exhaustive coverage. Exported `group(...)` entries are useful for reusable structures but can need explicit handler parameter annotations; use callback `.cases((group) => [...])` or `.partial((group) => [...])` when you want grouped entries with the strongest annotation-free handler inference.

### `.partial(...).otherwise(...)`

Use `.partial(...)` when only some tags need special behavior before a fallback.

```ts
const response = matchBy(cartAction, 'type')
  .partial({
    addItem: (action) => ({ type: 'recalculate', cartId: action.cartId, sku: action.sku }),
  })
  .otherwise((remaining) =>
    remaining.type === 'checkout'
      ? { type: 'reviewTotal', cartId: remaining.cartId, total: remaining.total }
      : { type: 'unchanged' },
  )
```

`.partial(...)` accepts object maps, tuple/grouped entry arrays, and callback-local grouped entries:

```ts
const review = matchBy(cartAction, 'type')
  .partial([
    ['addItem', (action) => ({ type: 'inventoryCheck', sku: action.sku, quantity: action.quantity })],
    [
      ['updateQuantity', 'applyCoupon'],
      (action) => ({
        type: 'pricePreview',
        cartId: action.cartId,
        subtotal: action.subtotal,
      }),
    ],
  ])
  .otherwise((remaining) =>
    remaining.type === 'checkout'
      ? { type: 'checkoutReview', cartId: remaining.cartId, total: remaining.total }
      : { type: 'noReview' },
  )
```

Use `.partial((group) => [...])` only for partial tag handling followed by `.otherwise(...)`, and only when the callback group form is clearer than chained `.with(...).otherwise(...)`. `partial` is not required to share one handler; for simple grouped tags, prefer variadic `.with(tag1, tag2, handler)`. Prefer variadic callback groups like `group('addItem', 'updateQuantity', handler)` while typing because they provide the best tag autocomplete; array groups like `group(['addItem', 'updateQuantity'], handler)` remain valid without `as const` when the grouped tag list reads better.

## `matchBy.promise(valueOrPromise, path)` use cases

`matchBy.promise(...)` mirrors `matchBy(...)`, but resolves the input internally and returns promises from terminal methods. Pass the promise directly; path, tag, case-map, partial-map, and grouped-case inference all use `Awaited<TInput>`.

```ts
type Order =
  | { state: 'pending'; id: string; total: number }
  | { state: 'paid'; id: string; total: number; receiptUrl: string }
  | { state: 'shipped'; id: string; trackingNumber: string }
  | { state: 'cancelled'; id: string; reason: string }

const orders: readonly Order[] = [{ state: 'paid', id: 'order-1', total: 49, receiptUrl: '/receipts/order-1' }]
const fallbackOrder: Order = { state: 'cancelled', id: 'missing', reason: 'not found' }

async function fetchOrder(id: string) {
  return orders.find((order) => order.id === id) ?? fallbackOrder
}

const orderView = await matchBy
  .promise(fetchOrder('order-1'), 'state')
  .with('pending', (order) => ({ screen: 'checkout', orderId: order.id, total: order.total }))
  .with('paid', (order) => ({ screen: 'receipt', orderId: order.id, receiptUrl: order.receiptUrl }))
  .with('shipped', (order) => ({ screen: 'tracking', orderId: order.id, trackingNumber: order.trackingNumber }))
  .with('cancelled', (order) => {
    throw new Error(`Order was cancelled: ${order.reason}`)
  })
  .exhaustive()
```

Normal terminals reject for input rejection, path-read errors, handler throws/rejections, fallback throws/rejections, and defensive non-exhaustiveness. `.otherwise(...)` is only a tag fallback; it does not catch input rejection.

Promise-safe terminals mirror `match.promise`:

```ts
const result = await matchBy
  .promise(fetchOrder('order-1'), 'state')
  .with('cancelled', (order) => ({ screen: 'cancelled', reason: order.reason }))
  .safeOtherwise((order) => ({ screen: 'order', orderId: order.id }))
```

All synchronous `matchBy` case shapes are available on promise builders; show only the shape needed for the example instead of stacking every feature into one snippet.

## `group(...)` use cases

Prefer variadic `.with(...)` before reaching for `group(...)`:

```ts
const status = matchBy(event, 'type')
  .with('start', 'resume', (event) => `active:${event.id}`)
  .with('stop', (event) => `stopped:${event.reason}`)
  .exhaustive()
```

Use callback `group` when case-list syntax is genuinely clearer or needed for generated/reusable/group-heavy case sets:

```ts
const status = matchBy(event, 'type').cases((group) => [
  group('start', 'resume', (event) => `active:${event.id}`),
  group('stop', 'pause', (event) => `inactive:${event.reason}`),
])
```

Do not use `group(...)` for one-to-one cases in normal application code. Use exported `group(...)` for reusable prebuilt groups, especially when handlers do not need narrowed parameters or are explicitly annotated:

```ts
const statusCases = [group(['start', 'resume'], () => 'active'), group('stop', () => 'inactive')]
```

Supported forms:

- `group(tag, handler)` — one tag.
- `group(tag1, tag2, ...moreTags, handler)` — two or more tags.
- `group(tags, handler)` — array/tuple tags; useful when tags read better together.

Array-form groups remain supported and are often more readable because `group` keeps two arguments. For exhaustiveness, array-form tags must be statically known: inline arrays count as covered tags; broad runtime arrays do not prove coverage.

## Pattern helpers

`P` namespace helpers:

- `P._`, `P.any` — wildcard helpers that match anything.
- `P.string`, `P.number`, `P.boolean`, `P.bigint`, `P.symbol`, `P.null`, `P.undefined` — primitive helpers.
- `P.nan`, `P.finite`, `P.integer` — numeric helpers.
- `P.union(...patterns)` — matches any listed pattern; requires at least one pattern.
- `P.exclude(pattern)` — matches values that do not match the nested pattern; cannot contain selections.
- `P.optional(pattern)` — matches an absent object property, `undefined`, or the nested pattern.
- `P.array(pattern)` — variable-length arrays where every item matches; selections inside are rejected.
- `P.nonEmptyArray(pattern)` — same as `P.array(...)` but requires at least one item.
- `P.tuple([...])` — explicit exact tuple pattern.
- `P.rest(pattern)` — remaining tuple items; valid only as the final tuple item.
- `P.exact(pattern)` — deep exact object pattern rejecting enumerable own extra value keys.
- `P.when(predicate)` — nested predicate or type guard pattern.
- `P.instanceOf(Constructor)` — `instanceof` pattern for classes/errors.
- `P.select()` — anonymous selection.
- `P.select(name)` — named selection of the current value.
- `P.select(name, pattern)` — named selection after nested validation.
- `P.record(keyPattern, valuePattern)` — plain record-like objects; empty records match.
- `P.nonEmptyRecord(keyPattern, valuePattern)` — plain record-like objects with at least one key.

Named helper exports mirror `P` helpers:

- `pWildcard`, `pAny`, `pString`, `pNumber`, `pBoolean`, `pBigint`, `pSymbol`, `pNull`, `pUndefined`
- `pNan`, `pFinite`, `pInteger`
- `pUnion`, `pExclude`, `pOptional`
- `pArray`, `pNonEmptyArray`, `pTuple`, `pRest`
- `pExact`, `pWhen`, `pInstanceOf`, `pSelect`, `pRecord`, `pNonEmptyRecord`

Use named helpers when codebases prefer focused imports or want helper usage visible to bundlers.

## Runtime guards and assertions

### `isMatching`

```ts
const isUser = isMatching({ type: 'user', id: P.string })
const users = values.filter(isUser)

if (isMatching({ type: 'user', id: P.string }, payload)) {
  payload.id
}
```

Use `isMatching` for filters, conditional branches, and non-throwing runtime validation. It supports direct and curried forms.

### `assertMatching`

```ts
const form = Object.fromEntries(new URLSearchParams('type=user&id=u1&role=admin'))
assertMatching({ type: 'user', id: P.string, role: P.union('admin', 'member') }, form)
form.id
```

Use `assertMatching` at boundaries where mismatch should throw: request bodies, form data, API payloads, webhook events, storage reads, test fixtures, and CLI arguments. A mismatch throws `PatternMismatchError`.

## Error and diagnostic APIs

- `NonExhaustiveMatchError` — thrown by `.exhaustive()` and exhaustive `matchBy(...).cases(...)` when runtime data reaches an unhandled branch. Exposes `matcher`, `path`, `tag`, `valuePreview`, and non-enumerable `value`.
- `PatternMismatchError` — thrown by `assertMatching(...)`. Exposes `valuePreview`, `patternPreview`, and non-enumerable `value`/`pattern`.
- `preview(value)` — low-level diagnostic helper from the errors subpath. Prefer error classes in normal app code.
- `MatchErrorMetadata` — metadata interface used by `NonExhaustiveMatchError`.

## Responding to `ts-match:` diagnostics

`ts-match` intentionally shapes common invalid usage into readable TypeScript diagnostics whose messages start with `ts-match:`. When helping a user or fixing generated code:

1. Read the `ts-match:` message before the surrounding TypeScript overload noise.
2. Apply the suggested fix directly.
3. Do not add unsafe casts, broad `any`, or manual type assertions to bypass the diagnostic.
4. Do not replace `matchBy` with `switch` just to silence an error.
5. Re-run the typecheck after fixing the modeled problem.

Common diagnostic fixes:

- `ts-match: match is not exhaustive` / `ts-match: matchBy is not exhaustive` — add missing `.with(...)` / grouped cases, or use `.otherwise(...)` only when fallback behavior is intentional.
- `ts-match: invalid matchBy path` — fix the direct key, dot path, or tuple path. Use tuple paths for symbol keys or keys containing `.`.
- `ts-match: this matchBy tag cannot occur` — remove the impossible tag or correct the path.
- `ts-match: object-map cases are missing required key(s)` — add missing handlers or change to `.partial(...).otherwise(...)`.
- `ts-match: object-map case contains an extra key` — remove the extra key or fix the discriminant path.
- `ts-match: object-map cases cannot represent null or undefined tags` / key collision diagnostics — use tuple-entry cases or callback grouped cases instead of an object map.
- `ts-match: repeated container patterns cannot contain P.select(...)` — move the selection outside `P.array(...)`, `P.nonEmptyArray(...)`, `P.record(...)`, or `P.nonEmptyRecord(...)`.
- `ts-match: P.exclude(pattern) cannot contain P.select(...)` — remove the selection or move it outside the excluded pattern.
- `ts-match: invalid P.rest(...) usage` — use `P.rest(...)` only as the final tuple pattern item.

If grouped-case handler inference is weak and variadic `.with(tag1, tag2, handler)` cannot express the needed structure cleanly, prefer callback-local `.cases((group) => [...])` or `.partial((group) => [...])` so the handler is typed from the active `matchBy` path. Use variadic callback groups (`group('a', 'b', handler)`) when editor tag suggestions matter; array-form groups (`group(['a', 'b'], handler)`) are supported without `as const` but may not get the same in-array literal completions. Use exported `group(...)` for reusable groups whose handlers do not need contextual variant inference.

## Important limitations

- `P.array(...)`, `P.nonEmptyArray(...)`, `P.record(...)`, and `P.nonEmptyRecord(...)` reject `P.select(...)` because captures may repeat ambiguously.
- `P.exclude(...)` cannot contain selections.
- `P.rest(...)` is valid only as the final tuple pattern item.
- `P.record(...)` and `P.nonEmptyRecord(...)` target plain record-like objects, not arrays, class instances, maps, sets, dates, regexps, or primitives.
- Dot paths always mean nesting. Use tuple paths for symbols and literal segments containing dots.
- Object patterns use normal JavaScript property lookup, so getters can run or throw and inherited properties can match.
- `P.exact(...)` rejects enumerable own extra keys on values, but it is not a cyclic graph matcher.
- Object-map `.cases({...})` cannot represent `null`, `undefined`, or normalized key collisions. Avoid bare `__proto__:` object-literal syntax; use computed `['__proto__']`, tuple/grouped entries, or callback grouped cases.
- Standalone exported `group(...)` cannot always infer handler parameter types from a later `.cases(...)` or `.partial(...)` call. Use callback-local `group` for annotation-free grouped handlers.
- No structural `Map`/`Set` helper exists. Use `P.instanceOf(Map)` / `P.instanceOf(Set)` plus `P.when(...)` for custom checks.
- No RegExp string helper exists. Use `P.when(...)`.

## Anti-patterns

- Importing internal files.
- Using undocumented helper aliases.
- Adding casts to force handler types instead of changing the pattern, path, or callback `group` shape.
- Using `match.promise(...)` or `matchBy.promise(...)` only because handlers are async while the matched input is already resolved; use plain `match(...)` / `matchBy(...)` and await the terminal result instead.
- Awaiting promise-producing sources before `match.promise(...)` or `matchBy.promise(...)` when passing the source directly would keep inference and error handling simpler.
- Using inline `.cases({...})` inside hot loops.
- Converting a simple chained `.with(...)` matcher into `.cases((group) => [...])` just to group one branch.
- Using `group(tag, handler)` for one-to-one cases where `.with(tag, handler)` is simpler.
- Recommending hoisted case maps that require manual handler annotations as normal user-facing code.
- Using object-map `.cases({...})` for `null`, `undefined`, bare `__proto__:` syntax, or normalized key collisions.
- Selecting inside repeated contexts such as arrays or records.
- Writing examples that are not compiled against the installed package.
- Writing examples that depend on one app's private domain, IPC payloads, or tool/event names instead of generic product/application scenarios.

## Validation checklist

Before introducing or modifying ts-match usage:

1. Confirm every imported symbol is listed in this skill or README.
2. Confirm examples import only from package root or documented subpaths.
3. Confirm closed unions use `.exhaustive()` or exhaustive `.cases(...)`.
4. Confirm simple same-handler cases use variadic `.with(...)` before considering callback `group(...)`.
5. Confirm `.partial(...)` is used only for partial handling plus fallback, not merely to access `group(...)`.
6. Confirm promise-backed sources are passed directly to `match.promise` or `matchBy.promise` when the resolved value is primarily consumed by the matcher.
7. Confirm safe terminals are used only on promise builders.
8. Confirm `safeOtherwise(...)` always has a fallback handler.
9. Confirm `matchBy.promise(...)` path/tag/case/group inference is based on the resolved input type.
10. Confirm no unsafe casts, broad `any`, internal imports, unsupported helper names, or `switch` rewrites were added.
11. Confirm docs/examples use generic scenarios; include JSX-return examples for UI-state use cases when helpful, without implying a React dependency.
12. Compile the affected project examples/tests.
13. If editing this library itself, run `pnpm check`, `pnpm pack:check`, and `pnpm test`.
14. If changing public types or overloads, ensure `pnpm test:editor-dx` is covered by `pnpm check` and verify packaged `dist/*.d.ts` autocomplete when relevant.
