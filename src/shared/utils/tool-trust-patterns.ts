const COMMAND_WHITESPACE_REGEX = /\s+/gu
const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'

export const COMMAND_PREFIX_TOKEN_COUNT: Readonly<Record<string, number>> = {
  bun: 2,
  git: 2,
  npm: 2,
  npx: 2,
  pnpm: 2,
  python: 1,
  python3: 1,
  yarn: 2,
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(COMMAND_WHITESPACE_REGEX, ' ')
}

export function deriveCommandPattern(command: string): string | null {
  const normalized = normalizeCommand(command)
  if (normalized.length === 0) {
    return null
  }

  const tokens = normalized.split(' ')
  const commandName = tokens[0]?.toLowerCase()
  if (!commandName) {
    return null
  }

  const requestedTokenCount = COMMAND_PREFIX_TOKEN_COUNT[commandName] ?? 1
  const tokenCount = Math.min(tokens.length, requestedTokenCount)
  const prefix = tokens.slice(0, tokenCount).join(' ')
  return `${prefix}*`
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
