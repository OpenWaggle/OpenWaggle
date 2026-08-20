export interface SlashCommandMatch {
  readonly query: string
  readonly startOffset: number
  readonly endOffset: number
}

const SLASH_QUERY_PATTERN = /(?:^|\s)\/([a-z0-9._-]*)$/i
const SLASH_QUERY_CHARACTER_PATTERN = /^[a-z0-9._-]/i

export function findSlashCommandMatch(
  text: string,
  cursorOffset: number,
): SlashCommandMatch | null {
  const safeCursorOffset = Math.max(0, Math.min(cursorOffset, text.length))
  const beforeCursor = text.slice(0, safeCursorOffset)
  const match = SLASH_QUERY_PATTERN.exec(beforeCursor)
  if (!match) return null

  const queryBeforeCursor = match[1] ?? ''
  const startOffset = safeCursorOffset - queryBeforeCursor.length - 1
  if (startOffset < 0) return null

  let endOffset = safeCursorOffset
  while (
    endOffset < text.length &&
    SLASH_QUERY_CHARACTER_PATTERN.test(text.slice(endOffset, endOffset + 1))
  ) {
    endOffset += 1
  }

  return {
    query: text.slice(startOffset + 1, endOffset).toLowerCase(),
    startOffset,
    endOffset,
  }
}

interface SlashCommandReplacement {
  readonly text: string
  readonly cursorOffset: number
}

export function replaceSlashCommandMatch(
  text: string,
  match: SlashCommandMatch,
  replacement: string,
  ensureTrailingSpace: boolean,
): SlashCommandReplacement {
  const before = text.slice(0, match.startOffset)
  let after = text.slice(match.endOffset)

  if (!replacement && before.endsWith(' ') && after.startsWith(' ')) {
    after = after.slice(1)
  }

  const trailingSpace = ensureTrailingSpace && !after.startsWith(' ') ? ' ' : ''
  return {
    text: `${before}${replacement}${trailingSpace}${after}`,
    cursorOffset: before.length + replacement.length + trailingSpace.length,
  }
}
