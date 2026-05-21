export interface MentionMatch {
  readonly query: string
  readonly startOffset: number
}

export function findMentionMatch(textContent: string, offset: number) {
  const textBeforeCursor = textContent.slice(0, offset)
  const atIndex = textBeforeCursor.lastIndexOf('@')
  if (atIndex === -1) return null
  if (atIndex > 0 && !/\s/.test(textBeforeCursor[atIndex - 1])) return null

  const query = textBeforeCursor.slice(atIndex + 1)
  if (/\s/.test(query)) return null
  return { query, startOffset: atIndex }
}
