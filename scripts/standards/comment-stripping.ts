/**
 * Comment stripping for the repository standards checks.
 *
 * These rules match text rather than parsing it, so comments have to come out first: a rule that
 * flags its own documentation is unusable.
 */
/**
 * Drop a trailing `//` comment, leaving code intact.
 *
 * Quotes are tracked so a `//` inside a string - a URL, most obviously - is not mistaken for one.
 */
function withoutTrailingComment(line: string) {
  let quote: string | null = null
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index] ?? ''
    if (quote !== null) {
      // A backslash escapes the next character, so it cannot close the string.
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '/' && line[index + 1] === '/') return line.slice(0, index)
  }
  return line
}

export function withoutCommentLines(contents: string) {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    /*
     * Trailing comments go too. The prefix check now matches anywhere in a line, so documenting the
     * convention beside code became a violation - which the earlier quote-anchored forms tolerated.
     */
    .map(withoutTrailingComment)
    .join('\n')
}
