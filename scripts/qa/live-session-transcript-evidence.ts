import { Schema } from '@shared/schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A transcript stream line that carries an item: `{ record: { record: 'item', item } }`. */
const isItemStreamLine = Schema.is(
  Schema.Struct({
    record: Schema.Struct({ record: Schema.Literal('item'), item: Schema.Unknown }),
  }),
)
/** The fields that name what a transcript entry is. */
const entryMarkerSchema = Schema.Struct({
  type: Schema.optional(Schema.Unknown),
  kind: Schema.optional(Schema.Unknown),
})
const spawnArgumentsSchema = Schema.Union(
  Schema.Struct({ action: Schema.Literal('spawn') }),
  Schema.Struct({ operation: Schema.Literal('spawn') }),
)
/** A `hive` spawn call, as a Pi tool call or as an OpenWaggle transcript tool-call item. */
const isSessionsSpawnToolCall = Schema.is(
  Schema.Union(
    Schema.Struct({
      type: Schema.Literal('toolCall'),
      name: Schema.Literal('hive'),
      arguments: spawnArgumentsSchema,
    }),
    Schema.Struct({
      type: Schema.Literal('tool-call'),
      toolCall: Schema.Struct({ name: Schema.Literal('hive'), args: spawnArgumentsSchema }),
    }),
  ),
)

function transcriptItems(jsonl: string) {
  return jsonl.split('\n').flatMap((line) => {
    if (!line) return []
    const parsed: unknown = JSON.parse(line)
    return isItemStreamLine(parsed) ? [parsed.record.item] : []
  })
}

function recordInvokedSkill(value: unknown, skillId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => recordInvokedSkill(entry, skillId))
  if (!isRecord(value) || !Schema.is(entryMarkerSchema)(value)) return false
  const marker = [value.type, value.kind]
    .filter((entry): entry is string => typeof entry === 'string')
    .join('-')
    .toLowerCase()
    .replaceAll(/[^a-z]/g, '')
  if (marker.includes('tool') && JSON.stringify(value).includes(skillId)) return true
  return Object.values(value).some((entry) => recordInvokedSkill(entry, skillId))
}

export function transcriptInvokedSkill(jsonl: string, skillId: string) {
  return transcriptItems(jsonl).some((item) => recordInvokedSkill(item, skillId))
}

function recordInvokedSessionsSpawn(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(recordInvokedSessionsSpawn)
  if (!isRecord(value)) return false
  if (isSessionsSpawnToolCall(value)) return true
  return Object.values(value).some(recordInvokedSessionsSpawn)
}

export function transcriptInvokedSessionsSpawn(jsonl: string) {
  return transcriptItems(jsonl).some(recordInvokedSessionsSpawn)
}
