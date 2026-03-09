import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { JsonObject } from '@shared/types/json'

/**
 * Safely parse a JSON string of tool arguments into a record.
 * Returns an empty object if parsing fails.
 */
export function parseToolArgs(args: string): JsonObject {
  try {
    const data: unknown = JSON.parse(args)
    const result = safeDecodeUnknown(jsonObjectSchema, data)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}
