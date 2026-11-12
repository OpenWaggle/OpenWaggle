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

const piUsageCostSchema = Schema.Struct({ total: lenientOptional(Schema.Finite) })

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

const decodeEntry = Schema.decodeUnknownOption(piSessionEntrySchema)

const NOT_JSON = Symbol('not JSON')

function parseJsonLine(line: string): unknown {
  const trimmed = line.trim()
  if (!trimmed) return NOT_JSON
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed
  } catch {
    return NOT_JSON
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
export function parsePiSessionEntryLine(line: string): PiSessionEntry | null {
  const parsed = parseJsonLine(line)
  if (parsed === NOT_JSON) return null
  if (!isObjectValue(parsed)) return {}
  return Option.getOrElse(decodeEntry(parsed), () => ({}))
}

/** A JSONL line as a session entry, or `null` when it is blank, not JSON, or not an object. */
export function parsePiSessionObjectLine(line: string): PiSessionEntry | null {
  const parsed = parseJsonLine(line)
  if (parsed === NOT_JSON || !isObjectValue(parsed)) return null
  return Option.getOrElse(decodeEntry(parsed), () => ({}))
}

/** The text of a user message, whether Pi stored it as a string or as content blocks. */
export function piUserMessageText(message: PiSessionMessage): string | null {
  if (message.role !== 'user') return null
  if (typeof message.content === 'string') return message.content
  if (message.content === undefined) return null
  return message.content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join(' ')
}
