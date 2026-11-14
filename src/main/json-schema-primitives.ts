import { Schema } from 'effect'

/**
 * Effect Schema building blocks whose `JSONSchema.make` output carries only the constraint
 * keywords (`minLength`, `maximum`, `const`, ...), without the titles and descriptions Effect's
 * built-in filters add, and whose failures name the broken bound without echoing the value.
 * MCP tool inputs and Agent definition frontmatter are published as JSON Schema built from them.
 */

interface Bounds {
  readonly min?: number
  readonly max?: number
}

function lengthKeywords({ min, max }: Bounds) {
  return {
    ...(min === undefined ? {} : { minLength: min }),
    ...(max === undefined ? {} : { maxLength: max }),
  }
}

function lengthIssue(length: number, { min, max }: Bounds) {
  if (min !== undefined && length < min) {
    return `Expected at least ${String(min)} character(s), got ${String(length)}`
  }
  if (max !== undefined && length > max) {
    return `Expected at most ${String(max)} character(s), got ${String(length)}`
  }
  return true
}

/** A string of `min` to `max` UTF-16 code units. */
export function boundedString(bounds: Bounds) {
  return Schema.String.pipe(
    Schema.filter((value) => lengthIssue(value.length, bounds), {
      jsonSchema: lengthKeywords(bounds),
    }),
  )
}

/**
 * A string trimmed before its length is checked; the trimmed value is the decoded one. JSON
 * Schema has no trim, so the bounds are published on the raw string, as written.
 */
export function trimmedString(bounds: Bounds) {
  return Schema.compose(Schema.Trim, boundedString(bounds)).annotations({
    jsonSchema: { type: 'string', ...lengthKeywords(bounds) },
  })
}

/** A string the whole of which `pattern` matches; the pattern is published without flags. */
export function patternString(pattern: RegExp) {
  return Schema.String.pipe(
    Schema.filter(
      (value) => pattern.test(value) || `Expected a string matching ${pattern.source}`,
      { jsonSchema: { pattern: pattern.source } },
    ),
  )
}

/** An absolute URL the WHATWG URL parser accepts. */
export const uriString = Schema.String.pipe(
  Schema.filter((value) => URL.canParse(value) || 'Expected an absolute URL', {
    jsonSchema: { format: 'uri' },
  }),
)

/** A safe integer from `min` to `max`, published with both bounds as JSON Schema `integer`. */
export function integer({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER }: Bounds) {
  return Schema.Number.pipe(
    Schema.filter(
      (value) => {
        if (!Number.isInteger(value)) return `Expected an integer, got ${String(value)}`
        if (value < min) return `Expected at least ${String(min)}, got ${String(value)}`
        if (value > max) return `Expected at most ${String(max)}, got ${String(value)}`
        return true
      },
      { jsonSchema: { type: 'integer', minimum: min, maximum: max } },
    ),
  )
}

/** One literal, published as `const` rather than a one-value `enum`. */
export function literal<const Value extends string | number | boolean>(value: Value) {
  return Schema.Literal(value).annotations({ jsonSchema: { type: typeof value, const: value } })
}

/**
 * One of `values`, published as a string `enum`. A refinement rather than a union of literals, so
 * a value outside it fails once, naming every allowed value, instead of once per literal.
 */
export function enumeration<const Values extends readonly [string, ...string[]]>(
  ...values: Values
) {
  const allowed = new Set<string>(values)
  return Schema.String.pipe(
    Schema.filter((value): value is Values[number] => allowed.has(value), {
      jsonSchema: { enum: values },
      message: () => `Expected one of ${values.map((value) => JSON.stringify(value)).join(' | ')}`,
    }),
  )
}

/** An array of at most `max` items. */
export function boundedArray<Item extends Schema.Schema.Any>(item: Item, max: number) {
  return Schema.Array(item).pipe(
    Schema.filter(
      (items) =>
        items.length <= max ||
        `Expected at most ${String(max)} item(s), got ${String(items.length)}`,
      { jsonSchema: { maxItems: max } },
    ),
  )
}

/** A check JSON Schema cannot express, such as uniqueness by a key, failing with `message`. */
export function check<Self extends Schema.Schema.Any>(
  test: (value: Schema.Schema.Type<Self>) => boolean,
  message: string,
) {
  return Schema.filter<Self>((value) => test(value) || message)
}

/** A property the input may leave out, but not set to `undefined`, which JSON cannot carry. */
export function optional<Value extends Schema.Schema.All>(schema: Value) {
  return Schema.optionalWith(schema, { exact: true })
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Any JSON value, published once under `$defs/JsonValue`. */
export const jsonValue: Schema.Schema<JsonValue> = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.suspend(() => jsonValue)),
  Schema.Record({ key: Schema.String, value: Schema.suspend(() => jsonValue) }),
).annotations({ identifier: 'JsonValue' })
