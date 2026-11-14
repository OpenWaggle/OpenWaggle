import { Option } from 'effect'
import { lenientArray, lenientOptional } from '@shared/schemas/lenient'
import { Schema, type SchemaType } from '@shared/schema'

/**
 * One line of a Pi session JSONL file as OpenWaggle's best-effort readers (discovery, Usage &
 * Cost) see it. Pi owns the format and older or other Pi clients write variations, so a field of
 * the wrong type reads as absent and the reader decides what a missing field means.
 */

const piContentPartSchema = Schema.Struct({
  type: lenientOptional(Schema.String),
  text: lenientOptional(Schema.String),
})

type PiContentPart = SchemaType<typeof piContentPartSchema>

const piUsageCostSchema = Schema.Struct({ total: lenientOptional(Schema.Finite) })

type PiUsageCost = SchemaType<typeof piUsageCostSchema>

export const piSessionUsageSchema = Schema.Struct({
  input: lenientOptional(Schema.Finite),
  output: lenientOptional(Schema.Finite),
  cacheRead: lenientOptional(Schema.Finite),
  cacheWrite: lenientOptional(Schema.Finite),
  totalTokens: lenientOptional(Schema.Number),
  cost: lenientOptional(piUsageCostSchema),
})

export type PiSessionUsage = SchemaType<typeof piSessionUsageSchema>

const piSessionMessageSchema = Schema.Struct({
  role: lenientOptional(Schema.String),
  content: lenientOptional(Schema.Union(Schema.String, lenientArray(piContentPartSchema))),
  timestamp: lenientOptional(Schema.Finite),
  provider: lenientOptional(Schema.String),
  model: lenientOptional(Schema.String),
  stopReason: lenientOptional(Schema.String),
  usage: lenientOptional(piSessionUsageSchema),
})

export type PiSessionMessage = SchemaType<typeof piSessionMessageSchema>

const piSessionEntrySchema = Schema.Struct({
  type: lenientOptional(Schema.String),
  id: lenientOptional(Schema.String),
  cwd: lenientOptional(Schema.String),
  timestamp: lenientOptional(Schema.String),
  name: lenientOptional(Schema.String),
  customType: lenientOptional(Schema.String),
  provider: lenientOptional(Schema.String),
  modelId: lenientOptional(Schema.String),
  model: lenientOptional(Schema.String),
  message: lenientOptional(piSessionMessageSchema),
  usage: lenientOptional(piSessionUsageSchema),
})

export type PiSessionEntry = SchemaType<typeof piSessionEntrySchema>

/*
 * The same entry, read strictly: each field holds the declared type or is absent. Almost every
 * line Pi writes is well formed, and this decode is about four times cheaper than the lenient one,
 * whose per-field transforms cost more than the line's JSON.parse. A line it refuses is read again
 * leniently, so the entry is the one the lenient schema gives either way. Each field list
 * satisfies the lenient type's keys, so a field added to one schema has to be added to the other.
 */
const exact = <A, I>(schema: Schema.Schema<A, I>) => Schema.optionalWith(schema, { exact: true })

const piContentPartStrictSchema = Schema.Struct({
  type: exact(Schema.String),
  text: exact(Schema.String),
} satisfies Record<keyof PiContentPart, unknown>)

const piUsageCostStrictSchema = Schema.Struct({
  total: exact(Schema.Finite),
} satisfies Record<keyof PiUsageCost, unknown>)

const piSessionUsageStrictSchema = Schema.Struct({
  input: exact(Schema.Finite),
  output: exact(Schema.Finite),
  cacheRead: exact(Schema.Finite),
  cacheWrite: exact(Schema.Finite),
  totalTokens: exact(Schema.Number),
  cost: exact(piUsageCostStrictSchema),
} satisfies Record<keyof PiSessionUsage, unknown>)

const piSessionMessageStrictSchema = Schema.Struct({
  role: exact(Schema.String),
  content: exact(Schema.Union(Schema.String, Schema.Array(piContentPartStrictSchema))),
  timestamp: exact(Schema.Finite),
  provider: exact(Schema.String),
  model: exact(Schema.String),
  stopReason: exact(Schema.String),
  usage: exact(piSessionUsageStrictSchema),
} satisfies Record<keyof PiSessionMessage, unknown>)

const piSessionEntryStrictSchema = Schema.Struct({
  type: exact(Schema.String),
  id: exact(Schema.String),
  cwd: exact(Schema.String),
  timestamp: exact(Schema.String),
  name: exact(Schema.String),
  customType: exact(Schema.String),
  provider: exact(Schema.String),
  modelId: exact(Schema.String),
  model: exact(Schema.String),
  message: exact(piSessionMessageStrictSchema),
  usage: exact(piSessionUsageStrictSchema),
} satisfies Record<keyof PiSessionEntry, unknown>)

const decodeStrictEntry = Schema.decodeUnknownOption(piSessionEntryStrictSchema)
const decodeLenientEntry = Schema.decodeUnknownOption(piSessionEntrySchema)

function decodeEntry(value: object) {
  const strict = decodeStrictEntry(value)
  const entry: PiSessionEntry = Option.isSome(strict)
    ? strict.value
    : Option.getOrElse(decodeLenientEntry(value), () => ({}))
  return entry
}

const NOT_JSON = Symbol('not JSON')

function parseJsonLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) {
    const result: unknown = NOT_JSON
    return result
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed
  } catch {
    const result: unknown = NOT_JSON
    return result
  }
}

function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A JSONL line as a session entry: `null` for a blank line or a line that is not JSON (one cut
 * by a read bound, or one Pi itself skips as malformed). JSON that is not an object is an entry
 * with no fields: it parsed, so it still decides that a file without a header is not a session.
 */
export function parsePiSessionEntryLine(line: string) {
  const parsed = parseJsonLine(line)
  if (parsed === NOT_JSON) return null
  if (!isObjectValue(parsed)) {
    const entry: PiSessionEntry | null = {}
    return entry
  }
  const entry: PiSessionEntry | null = decodeEntry(parsed)
  return entry
}

/** A JSONL line as a session entry, or `null` when it is blank, not JSON, or not an object. */
export function parsePiSessionObjectLine(line: string) {
  const parsed = parseJsonLine(line)
  if (parsed === NOT_JSON || !isObjectValue(parsed)) return null
  const entry: PiSessionEntry | null = decodeEntry(parsed)
  return entry
}

/** The text of a user message, whether Pi stored it as a string or as content blocks. */
export function piUserMessageText(message: PiSessionMessage) {
  if (message.role !== 'user') return null
  if (typeof message.content === 'string') {
    const result: string | null = message.content
    return result
  }
  if (message.content === undefined) return null
  const result: string | null = message.content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join(' ')
  return result
}
