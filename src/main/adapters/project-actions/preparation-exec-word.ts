const ESCAPED_CHARACTER_LENGTH = 2

interface WordState {
  word: string
  quote: "'" | '"' | undefined
  quoted: boolean
  invalid: boolean
  cursor: number
}

function consumeQuotedCharacter(character: string, state: WordState) {
  state.cursor += 1
  if (character === state.quote) {
    state.quote = undefined
    return
  }
  if (state.quote === '"' && character === '\\') {
    state.invalid = true
    return
  }
  state.word += character
}

function consumeUnquotedCharacter(command: string, character: string, state: WordState) {
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

/** Return the length of a shell word whose quote removal changes it to exec. */
export function quotedExecWordLength(command: string, index: number) {
  if (!/[e\\'"]/.test(command[index] ?? '')) return 0
  const state: WordState = {
    word: '',
    quote: undefined,
    quoted: false,
    invalid: false,
    cursor: index,
  }
  while (state.cursor < command.length && state.word.length <= 'exec'.length && !state.invalid) {
    const character = command[state.cursor]
    if (!character) break
    if (state.quote) {
      consumeQuotedCharacter(character, state)
      continue
    }
    if (!consumeUnquotedCharacter(command, character, state)) break
  }
  return !state.quote && !state.invalid && state.quoted && state.word === 'exec'
    ? state.cursor - index
    : 0
}
