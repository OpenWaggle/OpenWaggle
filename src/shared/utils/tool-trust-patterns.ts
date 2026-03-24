const COMMAND_WHITESPACE_REGEX = /\s+/gu
const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'

export function normalizeCommand(command: string): string {
  return command.trim().replace(COMMAND_WHITESPACE_REGEX, ' ')
}

/**
 * Derive a trust wildcard pattern from a command string.
 * Uses the first token (binary name) as the prefix — e.g. `pnpm test:unit`
 * produces `pnpm *`. This keeps pattern derivation fully automated without
 * needing a hardcoded map of known package managers.
 */
export function deriveCommandPattern(command: string): string | null {
  const normalized = normalizeCommand(command)
  if (normalized.length === 0) {
    return null
  }

  const firstToken = normalized.split(' ')[0]
  if (!firstToken) {
    return null
  }

  return `${firstToken} *`
}

export function normalizeWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== HTTP_PROTOCOL && protocol !== HTTPS_PROTOCOL) {
      return null
    }
    const host = parsed.hostname.toLowerCase()
    const port = parsed.port.length > 0 ? `:${parsed.port}` : ''
    const pathname = parsed.pathname.length > 0 ? parsed.pathname : '/'
    return `${protocol}//${host}${port}${pathname}${parsed.search}`
  } catch {
    return null
  }
}

export function deriveWebFetchPattern(url: string): string | null {
  const normalized = normalizeWebUrl(url)
  if (!normalized) {
    return null
  }

  const parsed = new URL(normalized)
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return `${parsed.origin}/*`
  }
  return `${parsed.origin}/${segments[0]}/*`
}
