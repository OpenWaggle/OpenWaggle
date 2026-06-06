import { safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { JsonValue } from '@shared/types/json'

export type UnknownObject = { readonly [key: string]: unknown }

export interface AgentLoopBaseEventFields {
  readonly timestamp: number
  readonly model?: string
  readonly rawEvent?: JsonValue
}

export function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringField(value: UnknownObject, key: string) {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

export function numberField(value: UnknownObject, key: string) {
  const field = value[key]
  return typeof field === 'number' ? field : null
}

export function optionalJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined
  }

  const decoded = safeDecodeUnknown(jsonValueSchema, value)
  return decoded.success ? decoded.data : undefined
}

export function parseJsonObject(raw: string): UnknownObject | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function baseEventFields(event: UnknownObject): AgentLoopBaseEventFields | null {
  const timestamp = numberField(event, 'timestamp')
  if (timestamp === null) {
    return null
  }

  const model = stringField(event, 'model')
  const rawEvent = optionalJsonValue(event.rawEvent)
  return {
    timestamp,
    ...(model !== null ? { model } : {}),
    ...(rawEvent !== undefined ? { rawEvent } : {}),
  }
}
