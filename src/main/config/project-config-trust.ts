import type { ToolApprovalPatternRule, ToolApprovalTrustEntry } from '@shared/types/tool-approval'
import { normalizeCommand } from '@shared/utils/tool-trust-patterns'
import { isRecord } from '@shared/utils/validation'

const COMMAND_CHAIN_OPERATOR_REGEX = /(?:&&|\|\||[;|<>])/u

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

  // If the prefix already ends with a space (e.g. "git "), the suffix
  // starts directly at the next token. Otherwise require a space separator
  // to prevent "gitx" matching "git*".
  if (!prefix.endsWith(' ') && !suffix.startsWith(' ')) {
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
