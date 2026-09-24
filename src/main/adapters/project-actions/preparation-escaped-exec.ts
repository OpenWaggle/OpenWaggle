import { heredocAt } from './preparation-heredoc'
import { quotedBuiltinWordLength } from './preparation-quoted-builtin'

const REDIRECTION_DOUBLE_LENGTH = 2
const REDIRECTION_TRIPLE_LENGTH = 3
const ARITHMETIC_START_LENGTH = 3
const ARITHMETIC_OPEN_DEPTH = 2
const INLINE_FUNCTION_BODY =
  /(?:^|[^\w])(?:function\s+[A-Za-z_]\w*(?:\(\))?|[A-Za-z_]\w*\(\))\s*\{\s*$/

interface ScanState {
  result: string
  quote: 'single' | 'double' | undefined
  comment: boolean
  arithmeticDepth: number
  pendingHeredocs: { delimiter: string; stripTabs: boolean }[]
  heredoc: { delimiter: string; stripTabs: boolean } | undefined
  lineStart: number
}

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

function isEvalCommandPosition(command: string, index: number, lineStart: number) {
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

function isEscapedExecPrefix(command: string, index: number) {
  if (command[index] !== '\\' || /[\w\\]/.test(command[index - 1] ?? '')) return false
  return /^\\(?:command|builtin)(?=\s+\\?exec(?!\w))/.test(command.slice(index))
}

function isCommentStart(command: string, index: number) {
  return command[index] === '#' && (index === 0 || /[\s;&|(){}]/.test(command[index - 1]))
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

function visitCommandWord(command: string, index: number, state: ScanState) {
  if (/<<-?\s*$/.test(command.slice(state.lineStart, index))) return undefined
  const evalLength = quotedBuiltinWordLength(command, index, 'eval')
  const execLength = quotedBuiltinWordLength(command, index, 'exec')
  if ((evalLength || execLength) && isEvalCommandPosition(command, index, state.lineStart)) {
    state.result += evalLength ? '__ow_eval' : 'exec'
    return index + (evalLength || execLength) - 1
  }
  if (isEscapedExecPrefix(command, index) && isEvalCommandPosition(command, index, state.lineStart))
    return index
  return undefined
}

function visitArithmetic(command: string, index: number, state: ScanState) {
  const character = command[index]
  if (state.arithmeticDepth > 0) {
    state.result += character
    if (character === '\\' && index + 1 < command.length) {
      state.result += command[index + 1]
      return index + 1
    }
    if (character === '(') state.arithmeticDepth += 1
    if (character === ')') state.arithmeticDepth -= 1
    return index
  }
  const expansion = command.startsWith('$((', index)
  if (!expansion && !command.startsWith('((', index)) return undefined
  state.arithmeticDepth = ARITHMETIC_OPEN_DEPTH
  state.result += expansion ? '$((' : '(('
  return index + (expansion ? ARITHMETIC_START_LENGTH : ARITHMETIC_OPEN_DEPTH) - 1
}

function visitCharacter(command: string, index: number, state: ScanState) {
  const character = command[index]
  if (state.quote) return visitQuote(command, index, state)
  if (character === '\n') {
    visitNewline(command, index, state)
    return index
  }
  if (state.heredoc || state.comment) {
    state.result += character
    return index
  }
  const arithmetic = visitArithmetic(command, index, state)
  if (arithmetic !== undefined) return arithmetic
  if (isCommentStart(command, index)) {
    state.comment = true
    state.result += character
    return index
  }
  const heredoc = heredocAt(command, index)
  if (heredoc) state.pendingHeredocs.push(heredoc)
  const rewritten = visitCommandWord(command, index, state)
  if (rewritten !== undefined) return rewritten
  if (character === "'" || character === '"') return visitOpeningQuote(command, index, state)
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
    arithmeticDepth: 0,
    pendingHeredocs: [],
    heredoc: undefined,
    lineStart: 0,
  }
  for (let index = 0; index < command.length; index += 1)
    index = visitCharacter(command, index, state)
  return state.result
}
