/**
 * The lines a change added to a file: lines of `after` whose trimmed text `before` did not have as
 * often, so a moved or reformatted line does not count as new. Pure; the cheat checks build on it.
 */
export interface AddedLine {
  /** 1-based line number in `after`. */
  readonly line: number
  readonly text: string
}

function counts(lines: readonly string[]) {
  const remaining = new Map<string, number>()
  for (const line of lines) remaining.set(line.trim(), (remaining.get(line.trim()) ?? 0) + 1)
  return remaining
}

/** Each line of `after` beyond the copies of its trimmed text that `before` held. */
export function addedLines(before: string | undefined, after: string) {
  const remaining = counts((before ?? '').split('\n'))
  return after.split('\n').flatMap((text, index) => {
    const key = text.trim()
    const left = remaining.get(key) ?? 0
    if (left > 0) {
      remaining.set(key, left - 1)
      return []
    }
    return key === '' ? [] : [{ line: index + 1, text }]
  })
}

/** The trimmed lines of `before` that `after` no longer holds as often. */
export function removedLines(before: string | undefined, after: string) {
  return addedLines(after, before ?? '').map((removed) => removed.text.trim())
}
