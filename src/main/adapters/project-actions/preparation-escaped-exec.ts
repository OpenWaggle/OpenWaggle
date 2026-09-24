const HEREDOC_START_END_OFFSET = 2
const HEREDOC_QUOTED_GROUP = 2
const HEREDOC_ESCAPED_GROUP = 3
const HEREDOC_PLAIN_GROUP = 4
const REDIRECTION_DOUBLE_LENGTH = 2
const REDIRECTION_TRIPLE_LENGTH = 3

interface ScanState {
  result: string
  quote: 'single' | 'double' | undefined
  comment: boolean
  pendingHeredocs: { delimiter: string; stripTabs: boolean }[]
  heredoc: { delimiter: string; stripTabs: boolean } | undefined
  lineStart: number
}

function isEscapedBuiltin(command: string, index: number, name: 'exec' | 'eval') {
  if (command[index] !== '\\') return false
  if (command.slice(index + 1, index + 1 + name.length) !== name) return false
  if (/[\w\\]/.test(command[index - 1] ?? '')) return false
  return !/\w/.test(command[index + 1 + name.length] ?? '')
}

function keepsCommandPosition(word: string) {
  return (
    word === '{' ||
    /^[A-Za-z_]\w*=/.test(word) ||
    /^(?:\\?(?:command|builtin)|if|then|else|elif|do|while|until|time|!)$/.test(word)
  )
}

interface EvalPrefixState {
  commandPosition: boolean
  redirectionTarget: boolean
  word: string
  quote: "'" | '"' | undefined
  groups: { commandPosition: boolean; redirectionTarget: boolean; word: string }[]
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
    else state.commandPosition = state.commandPosition && keepsCommandPosition(state.word)
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
}

function visitEvalPrefixUnquoted(
  command: string,
  cursor: number,
  index: number,
  state: EvalPrefixState,
) {
  const character = command[cursor]
  if (character === '\\' && cursor + 1 < index) {
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
    })
    state.commandPosition = true
    state.redirectionTarget = false
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
    state.word = ''
    return cursor
  }
  state.word += character
  return cursor
}

function isEvalCommandPosition(command: string, index: number, lineStart: number) {
  const state: EvalPrefixState = {
    commandPosition: true,
    redirectionTarget: false,
    word: '',
    quote: undefined,
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

function isEscapedEvalInvocation(command: string, index: number, lineStart: number) {
  return (
    isEscapedBuiltin(command, index, 'eval') && isEvalCommandPosition(command, index, lineStart)
  )
}

function isEscapedExecPrefix(command: string, index: number) {
  if (command[index] !== '\\' || /[\w\\]/.test(command[index - 1] ?? '')) return false
  return /^\\(?:command|builtin)(?=\s+\\?exec(?!\w))/.test(command.slice(index))
}

function isCommentStart(command: string, index: number) {
  return command[index] === '#' && (index === 0 || /[\s;&|(){}]/.test(command[index - 1]))
}

function heredocAt(command: string, index: number) {
  if (command[index] !== '<' || command[index + 1] !== '<') return undefined
  if (command[index - 1] === '<' || command[index + HEREDOC_START_END_OFFSET] === '<')
    return undefined
  const match = /^<<(-?)\s*(?:['"]([\w-]+)['"]|\\([\w-]+)|([\w-]+))/.exec(command.slice(index))
  if (!match) return undefined
  return {
    delimiter:
      match[HEREDOC_QUOTED_GROUP] ?? match[HEREDOC_ESCAPED_GROUP] ?? match[HEREDOC_PLAIN_GROUP],
    stripTabs: match[1] === '-',
  }
}

function visitNewline(command: string, index: number, state: ScanState) {
  state.result += '\n'
  state.comment = false
  if (state.heredoc) {
    const line = command.slice(state.lineStart, index)
    if ((state.heredoc.stripTabs ? line.replace(/^\t+/, '') : line) === state.heredoc.delimiter)
      state.heredoc = undefined
  }
  if (!state.heredoc) state.heredoc = state.pendingHeredocs.shift()
  state.lineStart = index + 1
}

function visitQuote(command: string, index: number, state: ScanState) {
  const character = command[index]
  state.result += character
  if (state.quote === 'single') {
    if (character === "'") state.quote = undefined
    return index
  }
  if (character === '\\' && index + 1 < command.length) {
    state.result += command[index + 1]
    return index + 1
  }
  if (character === '"') state.quote = undefined
  return index
}

function evaluatedLiteralAt(command: string, index: number, lineStart: number) {
  if (command[index] !== "'") return undefined
  const prefix = command.slice(lineStart, index)
  if (!/(?:^|[;&|({])\s*(?:(?:command|builtin)\s+)?eval\s+$/.test(prefix)) return undefined
  const end = command.indexOf("'", index + 1)
  if (end < 0) return undefined
  return { end, value: enableEscapedExecCapture(command.slice(index + 1, end)) }
}

function visitOpeningQuote(command: string, index: number, state: ScanState) {
  const evaluated = evaluatedLiteralAt(command, index, state.lineStart)
  if (evaluated) {
    state.result += `'${evaluated.value}'`
    return evaluated.end
  }
  state.quote = command[index] === "'" ? 'single' : 'double'
  state.result += command[index]
  return index
}

function visitCharacter(command: string, index: number, state: ScanState) {
  const character = command[index]
  if (character === '\n') {
    visitNewline(command, index, state)
    return index
  }
  if (state.heredoc || state.comment) {
    state.result += character
    return index
  }
  if (state.quote) return visitQuote(command, index, state)
  if (character === "'" || character === '"') return visitOpeningQuote(command, index, state)
  if (isCommentStart(command, index)) {
    state.comment = true
    state.result += character
    return index
  }
  const heredoc = heredocAt(command, index)
  if (heredoc) state.pendingHeredocs.push(heredoc)
  if (!/<<-?\s*$/.test(command.slice(state.lineStart, index))) {
    if (isEscapedEvalInvocation(command, index, state.lineStart)) {
      state.result += '__ow_'
      return index
    }
    if (isEscapedBuiltin(command, index, 'exec') || isEscapedExecPrefix(command, index))
      return index
  }
  state.result += character
  if (character !== '\\' || index + 1 >= command.length) return index
  state.result += command[index + 1]
  return index + 1
}

/** A backslash suppresses shell alias expansion even though \exec invokes the same builtin. */
export function enableEscapedExecCapture(command: string): string {
  const state: ScanState = {
    result: '',
    quote: undefined,
    comment: false,
    pendingHeredocs: [],
    heredoc: undefined,
    lineStart: 0,
  }
  for (let index = 0; index < command.length; index += 1)
    index = visitCharacter(command, index, state)
  return state.result
}
