/**
 * Parses what a user typed into the elicitation editor.
 *
 * Split out of `mcp-client-interactions.ts` to keep that file within its line limit. Rejects any
 * shape MCP does not allow rather than coercing it, so a malformed response surfaces as an error
 * instead of reaching a server as something the user did not write.
 */
export function parseElicitationContent(text: string) {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MCP elicitation response must be a JSON object.')
  }
  const content: Record<string, string | number | boolean | string[]> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      content[key] = value
      continue
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      content[key] = value
      continue
    }
    throw new Error(`MCP elicitation field ${JSON.stringify(key)} has an unsupported value.`)
  }
  return content
}
