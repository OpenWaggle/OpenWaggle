import { resolveTerminalFileTarget, resolveTerminalUrlTarget } from './terminal-link-paths'
import type {
  TerminalLinkActivationTarget,
  TerminalLinkMatch,
  TerminalLinkResolutionContext,
} from './terminal-link-types'

export { parseTerminalFileReference, resolveTerminalOsc8Target } from './terminal-link-paths'
export type {
  TerminalBufferCellLike,
  TerminalBufferLineLike,
  TerminalFileActivationTarget,
  TerminalLinkActivationTarget,
  TerminalLinkBufferPosition,
  TerminalLinkBufferRange,
  TerminalLinkMatch,
  TerminalLinkResolutionContext,
  TerminalLinkSource,
  TerminalUrlActivationTarget,
  WrappedTerminalLinkLine,
  WrappedTerminalLinkLineSegment,
} from './terminal-link-types'
export {
  collectWrappedTerminalLinkLine,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from './terminal-link-wrapping'

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/giu
const EXPLICIT_FILE_PATH_PATTERN =
  /(?:~[\\/]|\.{1,2}[\\/]|(?<![\p{L}\p{N}\p{M}_.~@+-])[A-Za-z]:[\\/]|\\\\|(?<![\p{L}\p{N}\p{M}_.~@+-])\/)[^\s"'`<>|]+/gu
const RELATIVE_FILE_PATH_PATTERN =
  /(?:[\p{L}\p{N}\p{M}_.~@+-]+[\\/])+[\p{L}\p{N}\p{M}_.~@+()[\]{},:$%+-]+/gu
const POSITIONED_BARE_FILE_PATH_PATTERN =
  /(?<![\p{L}\p{N}\p{M}_.~@+-])(?:\.[\p{L}\p{N}\p{M}_-]+|[\p{L}\p{N}\p{M}_@+-]+(?:\.[\p{L}\p{N}\p{M}_@+-]+)+)(?::\d+(?::\d+)?|\(\d+\s*,\s*\d+\))/gu
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?:]+$/u
const SCHEME_PREFIX_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/)?$/u
const SCHEME_WITH_AUTHORITY_PREFIX_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]*$/u
const MAC_PLATFORM_PATTERN = /mac|darwin|iphone|ipad|ipod/iu

function trimClosingDelimiters(rawValue: string) {
  let value = rawValue.replace(TRAILING_PUNCTUATION_PATTERN, '')
  const trimUnbalanced = (open: string, close: string) => {
    while (value.endsWith(close)) {
      const openCount = value.split(open).length - 1
      const closeCount = value.split(close).length - 1
      if (openCount >= closeCount) return
      value = value.slice(0, -1)
    }
  }
  trimUnbalanced('(', ')')
  trimUnbalanced('[', ']')
  trimUnbalanced('{', '}')
  return value
}

function rangesOverlap(
  left: Pick<TerminalLinkMatch, 'start' | 'end'>,
  right: Pick<TerminalLinkMatch, 'start' | 'end'>,
) {
  return left.start < right.end && right.start < left.end
}

function hasUnsafeSchemePrefix(line: string, start: number) {
  const prefix = line.slice(0, start)
  return SCHEME_PREFIX_PATTERN.test(prefix) || SCHEME_WITH_AUTHORITY_PREFIX_PATTERN.test(prefix)
}

function collectPatternMatches(
  line: string,
  pattern: RegExp,
  existing: readonly TerminalLinkMatch[],
  resolve: (value: string) => TerminalLinkActivationTarget | null,
) {
  const matches: TerminalLinkMatch[] = []
  pattern.lastIndex = 0
  for (const rawMatch of line.matchAll(pattern)) {
    const rawText = rawMatch[0]
    const start = rawMatch.index
    if (start === undefined || rawText.length === 0 || hasUnsafeSchemePrefix(line, start)) continue
    const text = trimClosingDelimiters(rawText)
    if (text.length === 0) continue
    const target = resolve(text)
    if (target === null) continue
    const match: TerminalLinkMatch = { text, start, end: start + text.length, target }
    if (existing.some((other) => rangesOverlap(match, other))) continue
    if (matches.some((other) => rangesOverlap(match, other))) continue
    matches.push(match)
  }
  return matches
}

/** Finds safe HTTP(S) URLs and file references in one logical terminal line. */
export function extractTerminalLinkMatches(
  line: string,
  context: TerminalLinkResolutionContext,
): readonly TerminalLinkMatch[] {
  const urls = collectPatternMatches(line, URL_PATTERN, [], (value) =>
    resolveTerminalUrlTarget(value, 'plain'),
  )
  const explicitPaths = collectPatternMatches(line, EXPLICIT_FILE_PATH_PATTERN, urls, (value) =>
    resolveTerminalFileTarget(value, 'plain', context),
  )
  const relativePaths = collectPatternMatches(
    line,
    RELATIVE_FILE_PATH_PATTERN,
    [...urls, ...explicitPaths],
    (value) => resolveTerminalFileTarget(value, 'plain', context),
  )
  const barePaths = collectPatternMatches(
    line,
    POSITIONED_BARE_FILE_PATH_PATTERN,
    [...urls, ...explicitPaths, ...relativePaths],
    (value) => resolveTerminalFileTarget(value, 'plain', context),
  )
  return [...urls, ...explicitPaths, ...relativePaths, ...barePaths].sort(
    (left: TerminalLinkMatch, right: TerminalLinkMatch) => left.start - right.start,
  )
}

/** Cmd-click on Apple platforms, Ctrl-click everywhere else. */
export function isTerminalLinkActivation(
  event: Readonly<{ metaKey: boolean; ctrlKey: boolean }>,
  platform: string,
) {
  if (platform.trim().length === 0) return false
  return MAC_PLATFORM_PATTERN.test(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}
