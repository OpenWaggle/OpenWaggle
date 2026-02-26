import { jsonValueSchema } from '@shared/schemas/validation'
import type { JsonValue } from '@shared/types/json'

/**
 * Extract a JSON object from LLM text output.
 * Handles markdown code fences, preamble text, and trailing commas.
 */
export function extractJson(text: string): JsonValue {
  let cleaned = text.trim()

  // Strip outer code fences using lastIndexOf to handle inner backtick blocks
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n')
    const lastFence = cleaned.lastIndexOf('```')
    if (firstNewline !== -1 && lastFence > firstNewline) {
      cleaned = cleaned.slice(firstNewline + 1, lastFence).trim()
    }
  }

  // Try direct parse
  try {
    return parseJsonValue(cleaned)
  } catch {
    // continue
  }

  // Try to isolate the outermost { ... }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1)
    try {
      return parseJsonValue(slice)
    } catch {
      // continue
    }

    // Fix trailing commas before } or ]
    const fixedCommas = slice.replace(/,\s*([}\]])/g, '$1')
    try {
      return parseJsonValue(fixedCommas)
    } catch {
      // continue
    }
  }

  throw new Error('Could not extract valid JSON from text')
}

function parseJsonValue(raw: string): JsonValue {
  const parsed = JSON.parse(raw)
  const result = jsonValueSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error('Parsed value is not valid JSON')
  }
  return result.data
}
