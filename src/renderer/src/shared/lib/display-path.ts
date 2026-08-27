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

const OPENWAGGLE_WORKTREE_PREFIX =
  /(?:[a-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*[\\/]\.openwaggle[\\/]worktrees[\\/][^\\/\s"'`<>|]+[\\/][^\\/\s"'`<>|]+[\\/]+/giu
const OPENWAGGLE_WORKTREE_ROOT =
  /(?:[a-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*[\\/]\.openwaggle[\\/]worktrees[\\/][^\\/\s"'`<>|]+[\\/][^\\/\s"'`<>|]+(?=$|[\s"'`<>|)\]},:;!?])/giu

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
