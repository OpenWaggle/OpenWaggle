import { parseJsonUnknown, Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { JsonValue } from '@shared/types/json'
import { createWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'

export const sessionJsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(sessionJsonValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: sessionJsonValueSchema })),
  ),
)

export const sessionJsonObjectSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: sessionJsonValueSchema }),
)

export type SessionJsonObject = SchemaType<typeof sessionJsonObjectSchema>

export function parseJsonValue(raw: string | null) {
  if (raw === null) {
    return undefined
  }
  return parseJsonUnknown(raw)
}

export function normalizeModelId(raw: string) {
  const trimmed = raw.trim()
  if (trimmed) {
    return trimmed
  }
  return undefined
}

export function hydrateWaggleConfig(raw: unknown): WaggleConfig | undefined {
  if (raw === undefined) {
    return undefined
  }

  const parsed = safeDecodeUnknown(waggleConfigSchema, raw)
  if (!parsed.success) {
    return undefined
  }

  return {
    ...parsed.data,
    agents: [
      {
        ...parsed.data.agents[0],
        model: createWaggleModelBinding(parsed.data.agents[0].model),
      },
      {
        ...parsed.data.agents[1],
        model: createWaggleModelBinding(parsed.data.agents[1].model),
      },
    ],
  }
}
