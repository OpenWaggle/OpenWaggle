const REDIRECTION_DOUBLE_LENGTH = 2
const REDIRECTION_TRIPLE_LENGTH = 3
const INLINE_FUNCTION_BODY =
  /(?:^|[^\w])(?:function\s+[A-Za-z_]\w*(?:\(\))?|[A-Za-z_]\w*\(\))\s*\{\s*$/

function keepsCommandPosition(word: string) {
  return (
    word === '{' ||
    /^[A-Za-z_]\w*=/.test(word) ||
    /^(?:\\?(?:command|builtin)|if|then|else|elif|do|while|until|time|!)$/.test(word)
  )
}

type CommandPrefix = 'command' | 'command-end-options' | 'time'

function commandPrefix(word: string): CommandPrefix | undefined {
  if (word === 'command' || word === '\\command') return 'command'
  return word === 'time' ? 'time' : undefined
}

function isSupportedPrefixOption(prefix: CommandPrefix | undefined, word: string) {
  return (
    (prefix === 'command' && (word === '--' || word === '-p')) ||
    (prefix === 'time' && word === '-p')
  )
}

interface EvalPrefixState {
  commandPosition: boolean
  redirectionTarget: boolean
  word: string
  quote: "'" | '"' | undefined
  prefix: CommandPrefix | undefined
  groups: {
    commandPosition: boolean
    redirectionTarget: boolean
    word: string
    prefix: CommandPrefix | undefined
  }[]
}

function visitEvalPrefixQuote(
  command: string,
  cursor: number,
  index: number,
  state: EvalPrefixState,
) {
  const character = command[cursor]
  state.word += character
  if (character === state.quote) {
    state.quote = undefined
    return cursor
  }
  if (state.quote === '"' && character === '\\' && cursor + 1 < index) {
    state.word += command[cursor + 1]
    return cursor + 1
  }
  return cursor
}

function finishEvalPrefixWord(state: EvalPrefixState) {
  if (state.word) {
    if (state.redirectionTarget) state.redirectionTarget = false
    else {
      const option = isSupportedPrefixOption(state.prefix, state.word)
      state.commandPosition = state.commandPosition && (option || keepsCommandPosition(state.word))
      if (option && state.word === '--') state.prefix = 'command-end-options'
      if (!option) state.prefix = commandPrefix(state.word)
    }
  }
  state.word = ''
}

function redirectionOperatorLength(command: string, cursor: number) {
  const triple = command.slice(cursor, cursor + REDIRECTION_TRIPLE_LENGTH)
  if (['&>>', '<<<', '<<-'].includes(triple)) return REDIRECTION_TRIPLE_LENGTH
  const double = command.slice(cursor, cursor + REDIRECTION_DOUBLE_LENGTH)
  if (['&>', '>>', '>|', '>&', '<<', '<&', '<>'].includes(double)) return REDIRECTION_DOUBLE_LENGTH
  return command[cursor] === '>' || command[cursor] === '<' ? 1 : 0
}

function visitEvalPrefixRedirection(command: string, cursor: number, state: EvalPrefixState) {
  const length = redirectionOperatorLength(command, cursor)
  if (!length) return undefined
  if (state.word && !/^\d+$/.test(state.word)) finishEvalPrefixWord(state)
  state.word = ''
  state.redirectionTarget = true
  return cursor + length - 1
}

function closeEvalPrefixGroup(state: EvalPrefixState) {
  const group = state.groups.pop()
  // A case arm may start with '('; its ')' still begins the command list.
  const casePattern = !group || (group.word === '(' && !group.redirectionTarget)
  state.commandPosition = casePattern || (group?.commandPosition ?? false)
  state.word = casePattern ? '' : `${group?.word ?? ''})`
  state.redirectionTarget = casePattern ? false : (group?.redirectionTarget ?? false)
  state.prefix = casePattern ? undefined : group?.prefix
}

function visitEvalPrefixUnquoted(
  command: string,
  cursor: number,
  index: number,
  state: EvalPrefixState,
) {
  const character = command[cursor]
  if (character === '\\' && cursor + 1 < index) {
    if (command[cursor + 1] === '\n') return cursor + 1
    state.word += character + command[cursor + 1]
    return cursor + 1
  }
  if (character === "'" || character === '"') {
    state.quote = character
    state.word += character
    return cursor
  }
  if (character === ' ' || character === '\t') {
    finishEvalPrefixWord(state)
    return cursor
  }
  const redirected = visitEvalPrefixRedirection(command, cursor, state)
  if (redirected !== undefined) return redirected
  if (character === '(') {
    state.groups.push({
      commandPosition: state.commandPosition,
      redirectionTarget: state.redirectionTarget,
      word: `${state.word}(`,
      prefix: state.prefix,
    })
    state.commandPosition = true
    state.redirectionTarget = false
    state.prefix = undefined
    state.word = ''
    return cursor
  }
  if (character === ')') {
    closeEvalPrefixGroup(state)
    return cursor
  }
  if (/[;&|]/.test(character)) {
    state.commandPosition = true
    state.redirectionTarget = false
    state.prefix = undefined
    state.word = ''
    return cursor
  }
  state.word += character
  return cursor
}

export function isEvalCommandPosition(command: string, index: number, lineStart: number) {
  if (INLINE_FUNCTION_BODY.test(command.slice(lineStart, index))) return true
  const state: EvalPrefixState = {
    commandPosition: true,
    redirectionTarget: false,
    word: '',
    quote: undefined,
    prefix: undefined,
    groups: [],
  }
  for (let cursor = lineStart; cursor < index; cursor += 1) {
    if (state.quote) {
      cursor = visitEvalPrefixQuote(command, cursor, index, state)
      continue
    }
    cursor = visitEvalPrefixUnquoted(command, cursor, index, state)
  }
  return state.word === '' && state.commandPosition && !state.redirectionTarget
}
