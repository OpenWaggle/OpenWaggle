import { unknownRecordSchema } from '@shared/schemas/validation'

/**
 * Safely parse a JSON string of tool arguments into a record.
 * Returns an empty object if parsing fails.
 */
export function parseToolArgs(args: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(args)
    const result = unknownRecordSchema.safeParse(data)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}
