import { Option } from 'effect'
import { Schema } from '@shared/schema'
import { isObjectValue } from '@shared/utils/object-shape'

/**
 * Fields for best-effort readers of files and payloads OpenWaggle does not own (Pi session
 * JSONL, MCP client configs, provider responses), where a field of the wrong type is treated as
 * absent instead of failing the whole value. Use these only where the old reader skipped a
 * malformed field on purpose; a contract OpenWaggle owns decodes strictly.
 */

/** A property that decodes to its value, or `undefined` when it is missing or does not decode. */
export function lenientOptional<A, I>(schema: Schema.Schema<A, I>) {
  const decode = Schema.decodeUnknownOption(schema)
  // explicit undefined: a malformed value decodes to an explicit undefined key
  return Schema.optional(
    Schema.transform(Schema.Unknown, Schema.UndefinedOr(Schema.typeSchema(schema)), {
      strict: true,
      decode: (value) => Option.getOrUndefined(decode(value)),
      encode: (value) => value,
    }),
  )
}

/** An array that keeps the items that decode and drops the rest; anything but an array is empty. */
export function lenientArray<A, I>(item: Schema.Schema<A, I>) {
  const decodeItem = Schema.decodeUnknownOption(item)
  return Schema.transform(Schema.Unknown, Schema.Array(Schema.typeSchema(item)), {
    strict: true,
    decode: (value) =>
      Array.isArray(value)
        ? value.flatMap((entry: unknown) => Option.toArray(decodeItem(entry)))
        : [],
    encode: (value) => value,
  })
}

/** The string-valued entries of an object; other entries are dropped, anything but an object is empty. */
export const lenientStringRecordSchema = Schema.transform(
  Schema.Unknown,
  Schema.Record({ key: Schema.String, value: Schema.String }),
  {
    strict: true,
    decode: (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    encode: (value) => value,
  },
)

/**
 * Any object but an array, as `isRecord` checked. A declaration, not an empty Struct: `Struct({})`
 * accepts strings, numbers and booleans, and its decode drops every key.
 */
export const anyObjectSchema = Schema.declare(isObjectValue, {
  description: 'an object that is not an array',
})

/** A map that keeps the entries whose value decodes and drops the rest; anything but an object is empty. */
export function lenientRecord<A, I>(value: Schema.Schema<A, I>) {
  const decodeValue = Schema.decodeUnknownOption(value)
  return Schema.transform(
    Schema.Unknown,
    Schema.Record({ key: Schema.String, value: Schema.typeSchema(value) }),
    {
      strict: true,
      decode: (input) => {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
        const entries: [string, A][] = []
        for (const [key, entry] of Object.entries(input)) {
          const decoded = decodeValue(entry)
          if (Option.isSome(decoded)) entries.push([key, decoded.value])
        }
        return Object.fromEntries(entries)
      },
      encode: (output) => output,
    },
  )
}

/** A string with something but whitespace in it. */
export const nonBlankStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0),
)
