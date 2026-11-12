import { safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { JsonValue } from '@shared/types/json'
import { uncheckedFields } from '@shared/utils/object-shape'

export interface AgentLoopBaseEventFields {
  readonly timestamp: number
  readonly model?: string
  readonly rawEvent?: JsonValue
}

export function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function numberOrNull(value: unknown) {
  return typeof value === 'number' ? value : null
}

export function optionalJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined
  }

  const decoded = safeDecodeUnknown(jsonValueSchema, value)
  return decoded.success ? decoded.data : undefined
}

export function parseJsonUnknownOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function baseEventFields(event: unknown): AgentLoopBaseEventFields | null {
  const fields = uncheckedFields<AgentLoopBaseEventFields>(event)
  const timestamp = numberOrNull(fields.timestamp)
  if (timestamp === null) {
    return null
  }

  const model = stringOrNull(fields.model)
  const rawEvent = optionalJsonValue(fields.rawEvent)
  return {
    timestamp,
    ...(model !== null ? { model } : {}),
    ...(rawEvent !== undefined ? { rawEvent } : {}),
  }
}
