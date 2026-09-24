import { isEvalCommandPosition } from './preparation-command-position'
import { heredocAt } from './preparation-heredoc'
import { type QuotedBuiltinSyntax, quotedBuiltinWordLength } from './preparation-quoted-builtin'

const ARITHMETIC_START_LENGTH = 3
const ARITHMETIC_OPEN_DEPTH = 2

interface ScanState {
  result: string
  quote: 'single' | 'double' | undefined
  comment: boolean
  arithmeticDepth: number
  pendingHeredocs: { delimiter: string; stripTabs: boolean }[]
  heredoc: { delimiter: string; stripTabs: boolean } | undefined
  lineStart: number
  commandStart: number
  substitutionDepth: number
  substitutionStarts: { depth: number; commandStart: number }[]
  quotedBuiltinSyntax: QuotedBuiltinSyntax
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
  state.commandStart = index + 1
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

function evaluatedLiteralAt(
  command: string,
  index: number,
  lineStart: number,
  syntax: QuotedBuiltinSyntax,
) {
  if (command[index] !== "'") return undefined
  const prefix = command.slice(lineStart, index)
  if (!/(?:^|[;&|({])\s*(?:(?:command|builtin)\s+)?eval\s+$/.test(prefix)) return undefined
  const end = command.indexOf("'", index + 1)
  if (end < 0) return undefined
  return { end, value: enableEscapedExecCapture(command.slice(index + 1, end), syntax) }
}

function visitOpeningQuote(command: string, index: number, state: ScanState) {
  const evaluated = evaluatedLiteralAt(
    command,
    index,
    state.commandStart,
    state.quotedBuiltinSyntax,
  )
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
  const evalLength = quotedBuiltinWordLength(command, index, 'eval', state.quotedBuiltinSyntax)
  const execLength = quotedBuiltinWordLength(command, index, 'exec', state.quotedBuiltinSyntax)
  if ((evalLength || execLength) && isEvalCommandPosition(command, index, state.commandStart)) {
    state.result += evalLength ? '__ow_eval' : 'exec'
    return index + (evalLength || execLength) - 1
  }
  if (
    isEscapedExecPrefix(command, index) &&
    isEvalCommandPosition(command, index, state.commandStart)
  )
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

function visitSubstitutionBoundary(command: string, index: number, state: ScanState) {
  const character = command[index]
  if (command.startsWith('$(', index) && !command.startsWith('$((', index)) {
    state.substitutionDepth += 1
    state.substitutionStarts.push({
      depth: state.substitutionDepth,
      commandStart: state.commandStart,
    })
    state.result += '$('
    return index + 1
  }
  if (character === '(' && state.substitutionDepth > 0) state.substitutionDepth += 1
  if (character !== ')' || state.substitutionDepth === 0) return undefined
  const current = state.substitutionStarts.at(-1)
  if (current?.depth === state.substitutionDepth) {
    state.commandStart = current.commandStart
    state.substitutionStarts.pop()
  }
  state.substitutionDepth -= 1
  state.result += ')'
  return index
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
  const substitution = visitSubstitutionBoundary(command, index, state)
  if (substitution !== undefined) return substitution
  if (character === "'" || character === '"') return visitOpeningQuote(command, index, state)
  state.result += character
  if (character !== '\\' || index + 1 >= command.length) return index
  state.result += command[index + 1]
  return index + 1
}

/** A backslash suppresses shell alias expansion even though \exec invokes the same builtin. */
export function enableEscapedExecCapture(
  command: string,
  quotedBuiltinSyntax: QuotedBuiltinSyntax = { ansi: true, locale: true },
): string {
  const state: ScanState = {
    result: '',
    quote: undefined,
    comment: false,
    arithmeticDepth: 0,
    pendingHeredocs: [],
    heredoc: undefined,
    lineStart: 0,
    commandStart: 0,
    substitutionDepth: 0,
    substitutionStarts: [],
    quotedBuiltinSyntax,
  }
  for (let index = 0; index < command.length; index += 1)
    index = visitCharacter(command, index, state)
  return state.result
}
