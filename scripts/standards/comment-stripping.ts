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

/**
 * Lines that sit inside a multi-line template literal.
 *
 * Trailing-comment stripping tracks quotes within a line, so a line *inside* a template literal opened
 * earlier was scanned as if it were code: a `//` in it - a URL, most obviously - truncated real code before
 * the convention checks ever saw it. Counting unescaped backticks tells us which lines to leave alone.
 */
const BACKTICKS_PER_PAIR = 2

function templateLiteralLineFlags(lines: readonly string[]) {
  const flags: boolean[] = []
  let inside = false
  for (const line of lines) {
    flags.push(inside)
    const backticks = (line.match(/(?<!\\)`/gu) ?? []).length
    if (backticks % BACKTICKS_PER_PAIR === 1) inside = !inside
  }
  return flags
}

export function withoutCommentLines(contents: string) {
  const withoutBlocks = contents.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  const withoutWholeLineComments = withoutBlocks.filter((line) => {
    const trimmed = line.trimStart()
    return !trimmed.startsWith('//') && !trimmed.startsWith('*')
  })
  return stripTrailingComments(withoutWholeLineComments).join('\n')
}

/**
 * Strip trailing comments, leaving the interior of multi-line template literals alone.
 *
 * The prefix check matches anywhere in a line, so documenting the convention beside code would otherwise be
 * a violation - but stripping inside a template literal deletes real code.
 */
function stripTrailingComments(lines: readonly string[]) {
  const insideTemplate = templateLiteralLineFlags(lines)
  return lines.map((line, index) => (insideTemplate[index] === true ? line : withoutTrailingComment(line)))
}
