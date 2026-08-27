const DISPLAY_ROOT_TERMINATORS = new Set([
  '',
  ' ',
  '\t',
  '\n',
  '\r',
  '"',
  "'",
  '`',
  ')',
  ']',
  '}',
  ',',
  ':',
  ';',
  '!',
  '?',
])

const DISPLAY_ROOT_PREFIX_TERMINATORS = new Set([
  '',
  ' ',
  '\t',
  '\n',
  '\r',
  '"',
  "'",
  '`',
  '(',
  '[',
  '{',
  '=',
  ':',
])
const ESCAPE_PARITY_DIVISOR = 2

const OPENWAGGLE_WORKTREE_PREFIX =
  /(?:[a-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*[\\/]\.openwaggle[\\/]worktrees[\\/][^\\/\r\n"'`<>|]+[\\/][^\\/\s"'`<>|]+[\\/]+/giu
const OPENWAGGLE_WORKTREE_ROOT =
  /(?:[a-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*[\\/]\.openwaggle[\\/]worktrees[\\/][^\\/\r\n"'`<>|]+[\\/][^\\/\s"'`<>|]+(?=$|[\s"'`<>|)\]},:;!?])/giu

function normalizePath(path: string) {
  const normalized = path
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
  if (normalized === '/') return normalized
  return normalized.replace(/\/$/, '')
}

function comparablePath(path: string) {
  const normalized = normalizePath(path)
  return /^[a-z]:\//i.test(normalized) ? normalized.toLocaleLowerCase() : normalized
}

function displayRoots(roots: readonly (string | null | undefined)[]) {
  const unique = new Map<string, string>()
  for (const root of roots) {
    if (!root?.trim()) continue
    const normalized = normalizePath(root)
    unique.set(comparablePath(normalized), normalized)
  }
  return [...unique.values()].sort((left, right) => right.length - left.length)
}

function pathRelativeToRoot(path: string, root: string) {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(root)
  const comparedPath = comparablePath(normalizedPath)
  const comparedRoot = comparablePath(normalizedRoot)

  if (comparedPath === comparedRoot) return '.'
  if (comparedRoot === '/' && comparedPath.startsWith('/')) return normalizedPath.slice(1)
  if (!comparedPath.startsWith(`${comparedRoot}/`)) return null
  return normalizedPath.slice(normalizedRoot.length + 1)
}

/**
 * Format a filesystem path for UI without changing the path used for file operations.
 * Paths inside an active project or Session worktree are shown from that root.
 */
export function formatDisplayPath(
  path: string,
  roots: readonly (string | null | undefined)[],
): string {
  for (const root of displayRoots(roots)) {
    const relative = pathRelativeToRoot(path, root)
    if (relative !== null) return relative
  }
  const inferred = normalizePath(path).replace(OPENWAGGLE_WORKTREE_PREFIX, '')
  if (inferred !== normalizePath(path)) return inferred || '.'
  if (OPENWAGGLE_WORKTREE_ROOT.test(normalizePath(path))) {
    OPENWAGGLE_WORKTREE_ROOT.lastIndex = 0
    return '.'
  }
  OPENWAGGLE_WORKTREE_ROOT.lastIndex = 0
  return path
}

function replaceRootVariantInText(text: string, root: string) {
  const caseInsensitive = /^[a-z]:[\\/]/i.test(root)
  const comparedRoot = caseInsensitive ? root.toLocaleLowerCase() : root
  const comparedText = caseInsensitive ? text.toLocaleLowerCase() : text
  let cursor = 0
  let nextMatch = comparedText.indexOf(comparedRoot, cursor)
  let result = ''

  while (nextMatch >= 0) {
    const afterRoot = nextMatch + root.length
    const previousCharacter = text[nextMatch - 1] ?? ''
    const nextCharacter = text[afterRoot] ?? ''
    const startsDisplayToken = DISPLAY_ROOT_PREFIX_TERMINATORS.has(previousCharacter)
    const isNestedPath = nextCharacter === '/' || nextCharacter === '\\'
    const isExactDisplayToken = DISPLAY_ROOT_TERMINATORS.has(nextCharacter)

    if (!startsDisplayToken || (!isNestedPath && !isExactDisplayToken)) {
      const unchangedEnd = afterRoot
      result += text.slice(cursor, unchangedEnd)
      cursor = unchangedEnd
      nextMatch = comparedText.indexOf(comparedRoot, cursor)
      continue
    }

    result += text.slice(cursor, nextMatch)
    if (isNestedPath) {
      let relativeStart = afterRoot
      while (text[relativeStart] === '/' || text[relativeStart] === '\\') relativeStart += 1
      cursor = relativeStart
    } else {
      result += '.'
      cursor = afterRoot
    }
    nextMatch = comparedText.indexOf(comparedRoot, cursor)
  }

  return `${result}${text.slice(cursor)}`
}

function replaceRootInText(text: string, root: string) {
  const normalizedRoot = normalizePath(root)
  const variants = new Set([normalizedRoot, normalizedRoot.replaceAll('/', '\\')])
  let result = text
  for (const variant of variants) {
    result = replaceRootVariantInText(result, variant)
  }
  return result
}

/** Shorten active project and Session worktree paths embedded in user-visible text. */
export function formatDisplayPathsInText(
  text: string,
  roots: readonly (string | null | undefined)[],
): string {
  let result = text
  for (const root of displayRoots(roots)) {
    result = replaceRootInText(result, root)
  }
  return result.replace(OPENWAGGLE_WORKTREE_PREFIX, '').replace(OPENWAGGLE_WORKTREE_ROOT, '.')
}

function isEscaped(text: string, index: number) {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % ESCAPE_PARITY_DIVISOR === 1
}

function backtickRunLength(text: string, index: number) {
  let length = 0
  while (text[index + length] === '`') length += 1
  return length
}

function matchingInlineCodeClose(text: string, start: number, delimiterLength: number) {
  let cursor = start
  while (cursor < text.length) {
    const next = text.indexOf('`', cursor)
    if (next < 0) return -1
    const runLength = backtickRunLength(text, next)
    if (!isEscaped(text, next) && runLength === delimiterLength) return next
    cursor = next + runLength
  }
  return -1
}

function formatMarkdownLine(line: string, roots: readonly (string | null | undefined)[]) {
  let result = ''
  let proseStart = 0
  let cursor = 0

  while (cursor < line.length) {
    const opening = line.indexOf('`', cursor)
    if (opening < 0) break
    const delimiterLength = backtickRunLength(line, opening)
    if (isEscaped(line, opening)) {
      cursor = opening + delimiterLength
      continue
    }
    const closing = matchingInlineCodeClose(line, opening + delimiterLength, delimiterLength)
    if (closing < 0) break

    result += formatDisplayPathsInText(line.slice(proseStart, opening), roots)
    const codeEnd = closing + delimiterLength
    result += line.slice(opening, codeEnd)
    proseStart = codeEnd
    cursor = codeEnd
  }

  return result + formatDisplayPathsInText(line.slice(proseStart), roots)
}

interface MarkdownFence {
  readonly marker: '`' | '~'
  readonly length: number
  readonly prefixLength: number
}

interface MarkdownCodeState {
  fence: MarkdownFence | null
  indentedCode: boolean
  previousLineBlank: boolean
}

function markdownFence(line: string): MarkdownFence | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line)
  const markerRun = match?.[1]
  const marker = markerRun?.[0]
  if (!match || !markerRun || (marker !== '`' && marker !== '~')) return null
  return { marker, length: markerRun.length, prefixLength: match[0].length }
}

function closesMarkdownFence(line: string, candidate: MarkdownFence | null, open: MarkdownFence) {
  return (
    candidate?.marker === open.marker &&
    candidate.length >= open.length &&
    line.slice(candidate.prefixLength).trim() === ''
  )
}

function formatMarkdownBlockLine(
  line: string,
  roots: readonly (string | null | undefined)[],
  state: MarkdownCodeState,
) {
  if (line === '\n' || line === '\r\n') return line
  const fence = markdownFence(line)
  if (state.fence) {
    if (closesMarkdownFence(line, fence, state.fence)) state.fence = null
    return line
  }
  if (fence) {
    state.fence = fence
    state.previousLineBlank = false
    return line
  }

  const blank = line.trim() === ''
  const codeIndented = /^(?: {4}|\t)/.test(line)
  if (state.indentedCode && (blank || codeIndented)) return line
  state.indentedCode = false
  if (codeIndented && state.previousLineBlank) {
    state.indentedCode = true
    state.previousLineBlank = false
    return line
  }

  state.previousLineBlank = blank
  return formatMarkdownLine(line, roots)
}

/** Shorten paths in Markdown prose while preserving the exact contents of inline and fenced code. */
export function formatDisplayPathsInMarkdown(
  markdown: string,
  roots: readonly (string | null | undefined)[],
): string {
  const state: MarkdownCodeState = {
    fence: null,
    indentedCode: false,
    previousLineBlank: true,
  }

  return markdown
    .split(/(\r?\n)/)
    .map((line) => formatMarkdownBlockLine(line, roots, state))
    .join('')
}
