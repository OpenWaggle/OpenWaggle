/**
 * Safely parse a JSON string of tool arguments into a record.
 * Returns an empty object if parsing fails.
 */
export function parseToolArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}
