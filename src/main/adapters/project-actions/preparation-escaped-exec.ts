const EXEC_TOKEN_END_OFFSET = 5
const HEREDOC_START_END_OFFSET = 2
const HEREDOC_QUOTED_GROUP = 2
const HEREDOC_ESCAPED_GROUP = 3
const HEREDOC_PLAIN_GROUP = 4

interface ScanState {
  result: string
  quote: 'single' | 'double' | undefined
  comment: boolean
  pendingHeredocs: { delimiter: string; stripTabs: boolean }[]
  heredoc: { delimiter: string; stripTabs: boolean } | undefined
  lineStart: number
}

function isEscapedExec(command: string, index: number) {
  if (command[index] !== '\\') return false
  if (command.slice(index + 1, index + EXEC_TOKEN_END_OFFSET) !== 'exec') return false
  if (/[\w\\]/.test(command[index - 1] ?? '')) return false
  return !/\w/.test(command[index + EXEC_TOKEN_END_OFFSET] ?? '')
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
  if (character === "'" || character === '"') {
    state.quote = character === "'" ? 'single' : 'double'
    state.result += character
    return index
  }
  if (isCommentStart(command, index)) {
    state.comment = true
    state.result += character
    return index
  }
  const heredoc = heredocAt(command, index)
  if (heredoc) state.pendingHeredocs.push(heredoc)
  if (isEscapedExec(command, index) && !/<<-?\s*$/.test(command.slice(state.lineStart, index)))
    return index
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
