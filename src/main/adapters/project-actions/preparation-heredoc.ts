const HEREDOC_START_END_OFFSET = 2
const HEREDOC_ESCAPE_ADVANCE = 2

type HeredocQuote = 'single' | 'double'

function quotedHeredocCharacter(command: string, cursor: number, quote: HeredocQuote) {
  const character = command[cursor]
  if (quote === 'single') {
    return character === "'"
      ? { value: '', advance: 1, quote: undefined }
      : { value: character, advance: 1, quote }
  }
  if (character === '"') return { value: '', advance: 1, quote: undefined }
  if (character !== '\\' || cursor + 1 >= command.length)
    return { value: character, advance: 1, quote }
  const next = command[cursor + 1]
  if (next === '\n') return { value: '', advance: HEREDOC_ESCAPE_ADVANCE, quote }
  if (['$', '"', '\\', '`'].includes(next))
    return { value: next, advance: HEREDOC_ESCAPE_ADVANCE, quote }
  return { value: character, advance: 1, quote }
}

function unquotedHeredocCharacter(command: string, cursor: number) {
  const character = command[cursor]
  if (character === "'" || character === '"') {
    return { value: '', advance: 1, quote: character === "'" ? 'single' : 'double' } as const
  }
  if (character === '\\' && cursor + 1 < command.length) {
    const next = command[cursor + 1]
    return {
      value: next === '\n' ? '' : next,
      advance: HEREDOC_ESCAPE_ADVANCE,
      quote: undefined,
    }
  }
  return { value: character, advance: 1, quote: undefined }
}

function heredocDelimiter(command: string, start: number) {
  let cursor = start
  let quote: HeredocQuote | undefined
  let delimiter = ''
  let sawWord = false
  while (cursor < command.length) {
    const character = command[cursor]
    if (!quote && /[\s;&|<>()]/.test(character)) break
    if (quote) {
      const part = quotedHeredocCharacter(command, cursor, quote)
      delimiter += part.value
      cursor += part.advance
      quote = part.quote
      continue
    }
    sawWord = true
    const part = unquotedHeredocCharacter(command, cursor)
    delimiter += part.value
    cursor += part.advance
    quote = part.quote
  }
  return sawWord && !quote ? delimiter : undefined
}

export function heredocAt(command: string, index: number) {
  if (command[index] !== '<' || command[index + 1] !== '<') return undefined
  if (command[index - 1] === '<' || command[index + HEREDOC_START_END_OFFSET] === '<')
    return undefined
  let cursor = index + HEREDOC_START_END_OFFSET
  const stripTabs = command[cursor] === '-'
  if (stripTabs) cursor += 1
  while (command[cursor] === ' ' || command[cursor] === '\t') cursor += 1
  const delimiter = heredocDelimiter(command, cursor)
  return delimiter === undefined ? undefined : { delimiter, stripTabs }
}
