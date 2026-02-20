/**
 * Shared validation utilities used by both main and renderer processes.
 */

/**
 * Validates that a string is a well-formed base URL with http: or https: protocol.
 * Used for provider baseUrl validation in settings (both read and write paths).
 */
export function isValidBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
