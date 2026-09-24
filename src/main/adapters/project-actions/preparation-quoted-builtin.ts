const ESCAPED_CHARACTER_LENGTH = 2
const ANSI_QUOTE_PREFIX_LENGTH = 2
const OCTAL_RADIX = 8
const HEX_RADIX = 16
const ASCII_MAX = 0x7f

export interface QuotedBuiltinSyntax {
  ansi: boolean
  locale: boolean
}

const EXTENDED_QUOTE_SYNTAX: QuotedBuiltinSyntax = { ansi: true, locale: true }

interface WordState {
  word: string
  quote: "'" | '"' | 'ansi' | 'locale' | undefined
  quoted: boolean
  invalid: boolean
  cursor: number
}

function ansiCharacter(command: string, cursor: number) {
  const remainder = command.slice(cursor + 1)
  const numeric = /^(?:x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|([0-7]{1,3}))/.exec(
    remainder,
  )
  if (!numeric) return undefined
  const [, hex, shortUnicode, longUnicode, octal] = numeric
  const digits = hex ?? shortUnicode ?? longUnicode ?? octal
  const value = Number.parseInt(digits, octal ? OCTAL_RADIX : HEX_RADIX)
  if (value > ASCII_MAX) return undefined
  return { character: String.fromCharCode(value), length: numeric[0].length + 1 }
}

function consumeAnsiCharacter(command: string, state: WordState) {
  const character = command[state.cursor]
  if (character === "'") {
    state.quote = undefined
    state.cursor += 1
    return
  }
  if (character === '\\') {
    const decoded = ansiCharacter(command, state.cursor)
    if (!decoded) {
      state.invalid = true
      return
    }
    state.word += decoded.character
    state.cursor += decoded.length
    return
  }
  state.word += character
  state.cursor += 1
}

function consumeQuotedCharacter(character: string, state: WordState) {
  state.cursor += 1
  if (character === (state.quote === 'locale' ? '"' : state.quote)) {
    state.quote = undefined
    return
  }
  if ((state.quote === '"' || state.quote === 'locale') && character === '\\') {
    state.invalid = true
    return
  }
  state.word += character
}

function consumeUnquotedCharacter(
  command: string,
  character: string,
  state: WordState,
  syntax: QuotedBuiltinSyntax,
) {
  if (
    character === '$' &&
    ((syntax.ansi && command[state.cursor + 1] === "'") ||
      (syntax.locale && command[state.cursor + 1] === '"'))
  ) {
    state.quote = command[state.cursor + 1] === "'" ? 'ansi' : 'locale'
    state.quoted = true
    state.cursor += ANSI_QUOTE_PREFIX_LENGTH
    return true
  }
  if (character === "'" || character === '"') {
    state.quote = character
    state.quoted = true
    state.cursor += 1
    return true
  }
  if (character === '\\') {
    const next = command[state.cursor + 1]
    if (!next || next === '\n') return false
    state.word += next
    state.quoted = true
    state.cursor += ESCAPED_CHARACTER_LENGTH
    return true
  }
  if (/[\s;&|()<>{}]/.test(character)) return false
  state.word += character
  state.cursor += 1
  return true
}

/** Return the length of a shell word whose quote removal changes it to a captured builtin. */
export function quotedBuiltinWordLength(
  command: string,
  index: number,
  name: 'exec' | 'eval',
  syntax: QuotedBuiltinSyntax = EXTENDED_QUOTE_SYNTAX,
) {
  if (!/[e$\\'"]/.test(command[index] ?? '')) return 0
  const state: WordState = {
    word: '',
    quote: undefined,
    quoted: false,
    invalid: false,
    cursor: index,
  }
  while (state.cursor < command.length && state.word.length <= name.length && !state.invalid) {
    const character = command[state.cursor]
    if (!character) break
    if (state.quote === 'ansi') {
      consumeAnsiCharacter(command, state)
      continue
    }
    if (state.quote) {
      consumeQuotedCharacter(character, state)
      continue
    }
    if (!consumeUnquotedCharacter(command, character, state, syntax)) break
  }
  return !state.quote && !state.invalid && state.quoted && state.word === name
    ? state.cursor - index
    : 0
}
