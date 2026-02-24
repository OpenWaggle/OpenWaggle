import type { z } from 'zod'

/**
 * Parse a JSON string and validate against a Zod schema.
 * Throws on invalid JSON or schema mismatch.
 */
export function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  const data: unknown = JSON.parse(raw)
  return schema.parse(data)
}

/**
 * Parse a JSON string and safely validate against a Zod schema.
 * Returns the same shape as `schema.safeParse()` — never throws.
 * On JSON syntax errors, returns `{ success: false, data: undefined }`.
 */
export function parseJsonSafe<T>(
  raw: string,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false; data: undefined } {
  try {
    const data: unknown = JSON.parse(raw)
    const result = schema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, data: undefined }
  } catch {
    return { success: false, data: undefined }
  }
}
