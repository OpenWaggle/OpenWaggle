import type { ToolApprovalPatternRule, ToolApprovalTrustEntry } from '@shared/types/tool-approval'
import { isRecord } from '@shared/utils/validation'

const COMMAND_WHITESPACE_REGEX = /\s+/gu
const COMMAND_CHAIN_OPERATOR_REGEX = /(^|\s)(?:&&|\|\||[;|<>])(?=\s|$)/u
const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'

const COMMAND_PREFIX_TOKEN_COUNT: Readonly<Record<string, number>> = {
  bun: 2,
  git: 2,
  npm: 2,
  npx: 2,
  pnpm: 2,
  python: 1,
  python3: 1,
  yarn: 2,
}

export function parseRawArgsObject(rawArgs: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawArgs)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function getStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
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

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  const wildcardRegex = escaped.replaceAll('*', '.*')
  return new RegExp(`^${wildcardRegex}$`, 'u')
}

export function wildcardMatch(value: string, pattern: string): boolean {
  return wildcardToRegExp(pattern).test(value)
}

export function commandPatternMatch(command: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return command === pattern
  }

  const singleTrailingWildcard =
    pattern.endsWith('*') && pattern.indexOf('*') === pattern.length - 1
  if (!singleTrailingWildcard) {
    return false
  }

  const prefix = pattern.slice(0, -1)
  if (!command.startsWith(prefix)) {
    return false
  }

  const suffix = command.slice(prefix.length)
  if (suffix.length === 0) {
    return true
  }

  if (!suffix.startsWith(' ')) {
    return false
  }

  const normalizedSuffix = normalizeCommand(suffix).trimStart()
  return !COMMAND_CHAIN_OPERATOR_REGEX.test(normalizedSuffix)
}

export function hasTrustData(entry: ToolApprovalTrustEntry | undefined): boolean {
  return (
    entry?.trusted !== undefined ||
    entry?.timestamp !== undefined ||
    entry?.source !== undefined ||
    (entry?.allowPatterns?.length ?? 0) > 0
  )
}

export function appendAllowPattern(
  existing: readonly ToolApprovalPatternRule[] | undefined,
  pattern: string,
  timestamp: string,
  source: string,
): ToolApprovalPatternRule[] {
  const next = existing ? [...existing] : []
  const duplicate = next.some((rule) => rule.pattern === pattern)
  if (!duplicate) {
    next.push({ pattern, timestamp, source })
  }
  return next
}
