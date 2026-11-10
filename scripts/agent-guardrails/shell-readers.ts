/**
 * Pure readers for the shell scanner (`shell-scanner.ts`): each takes the text and an index and
 * returns what it read and where it stopped, so the scanner only keeps state.
 */

export interface Read {
  readonly text: string
  /** The index just past what was read. */
  readonly end: number
}

export const PAIR = 2
export const TRIPLE = 3

const LEADING_TABS = /^\t+/
const ANSI_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
])
const REDIRECTION = /^(?:&>>|&>|>>|>\||>&|<>|<&|>|<)/

export function indexOrEnd(text: string, search: string, from: number) {
  const found = text.indexOf(search, from)
  return found === -1 ? text.length : found
}

/** `'...'` starting at its opening quote: the text is literal. */
export function singleQuoted(text: string, index: number): Read {
  const end = indexOrEnd(text, "'", index + 1)
  return { text: text.slice(index + 1, end), end: end + 1 }
}

/** `$'...'` starting at its `$`: backslash escapes are decoded. */
export function ansiQuoted(text: string, index: number): Read {
  let cursor = index + PAIR
  let value = ''
  while (cursor < text.length && text[cursor] !== "'") {
    const char = text[cursor] ?? ''
    if (char === '\\') {
      const escaped = text[cursor + 1] ?? ''
      value += ANSI_ESCAPES.get(escaped) ?? escaped
      cursor += PAIR
      continue
    }
    value += char
    cursor += 1
  }
  return { text: value, end: cursor + 1 }
}

/** The script between backticks, starting at the opening backtick. */
export function backtickScript(text: string, index: number): Read {
  let cursor = index + 1
  let script = ''
  while (cursor < text.length && text[cursor] !== '`') {
    if (text[cursor] === '\\' && text[cursor + 1] === '`') {
      script += '`'
      cursor += PAIR
      continue
    }
    script += text[cursor] ?? ''
    cursor += 1
  }
  return { text: script, end: cursor + 1 }
}

/** The index just past `$(( ... ))`, which is arithmetic, not a command. */
export function arithmeticEnd(text: string, index: number) {
  const end = text.indexOf('))', index + TRIPLE)
  return end === -1 ? text.length : end + PAIR
}

/** The redirection operator at the start of `rest`: `>`, `>>`, `&>`, `>&`, `<`, ... */
export function redirectionOperator(rest: string) {
  return REDIRECTION.exec(rest)?.[0] ?? rest.charAt(0)
}

/** A here-document body from `index` up to its delimiter line. */
export function heredocBody(
  text: string,
  index: number,
  delimiter: string,
  stripTabs: boolean,
): Read {
  const lines: string[] = []
  let cursor = index
  while (cursor < text.length) {
    const end = indexOrEnd(text, '\n', cursor)
    const line = text.slice(cursor, end)
    cursor = end + 1
    const compared = stripTabs ? line.replace(LEADING_TABS, '') : line
    if (compared === delimiter) {
      break
    }
    lines.push(compared)
  }
  return { text: lines.join('\n'), end: cursor }
}
