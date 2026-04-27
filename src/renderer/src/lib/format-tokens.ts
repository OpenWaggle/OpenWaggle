const THOUSAND = 1_000
const MILLION = 1_000_000

/** Format a token count for compact display. */
export function formatTokens(tokens: number): string {
  if (tokens < THOUSAND) return String(tokens)
  if (tokens < MILLION) return `${Math.round(tokens / THOUSAND)}k`
  return `${(tokens / MILLION).toFixed(1)}m`
}

/** Format a context window size (e.g., "200k", "1M"). */
export function formatContextWindow(tokens: number): string {
  if (tokens >= MILLION) return `${(tokens / MILLION).toFixed(0)}M`
  return `${Math.round(tokens / THOUSAND)}k`
}
