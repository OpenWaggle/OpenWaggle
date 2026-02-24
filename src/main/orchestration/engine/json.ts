/**
 * Extract a JSON object from LLM text output.
 * Handles markdown code fences, preamble text, and trailing commas.
 */
export function extractJson(text: string): unknown {
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
    const parsed: unknown = JSON.parse(cleaned)
    return parsed
  } catch {
    // continue
  }

  // Try to isolate the outermost { ... }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1)
    try {
      const parsed: unknown = JSON.parse(slice)
      return parsed
    } catch {
      // continue
    }

    // Fix trailing commas before } or ]
    const fixedCommas = slice.replace(/,\s*([}\]])/g, '$1')
    try {
      const parsed: unknown = JSON.parse(fixedCommas)
      return parsed
    } catch {
      // continue
    }
  }

  throw new Error('Could not extract valid JSON from text')
}
