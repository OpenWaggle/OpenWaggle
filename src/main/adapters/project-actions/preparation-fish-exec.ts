const COMMAND_PREFIXES = new Set(['and', 'if', 'not', 'or', 'time', 'while'])
const ESCAPED_CHARACTER_LENGTH = 2

interface FishExecScan {
  readonly code: string
  output: string
  index: number
  commandStart: boolean
  quote: "'" | '"' | null
  comment: boolean
  parenDepth: number
  enclosingCommandStarts: boolean[]
  evalWrappers: number[]
}

function tokenEnd(code: string, start: number) {
  let end = start
  while (end < code.length && !/[\s;|&()<>]/.test(code[end] ?? '')) end += 1
  return end
}

function closeEvalWrappers(scan: FishExecScan) {
  while (scan.evalWrappers.at(-1) === scan.parenDepth) {
    scan.output += ' | string collect -N)'
    scan.evalWrappers.pop()
  }
}

function wrapEval(scan: FishExecScan, end: number) {
  scan.output += 'eval (__ow_rewrite_eval'
  scan.evalWrappers.push(scan.parenDepth)
  scan.commandStart = false
  scan.index = end
}

function visitComment(scan: FishExecScan) {
  const character = scan.code[scan.index] ?? ''
  scan.output += character
  if (character === '\n') {
    scan.comment = false
    scan.commandStart = true
  }
  scan.index += 1
}

function visitQuote(scan: FishExecScan) {
  const character = scan.code[scan.index] ?? ''
  scan.output += character
  if (character === '\\' && scan.index + 1 < scan.code.length) {
    scan.output += scan.code[scan.index + 1]
    scan.index += ESCAPED_CHARACTER_LENGTH
    return
  }
  if (character === scan.quote) scan.quote = null
  scan.index += 1
}

function prefixedBuiltinEvalEnd(scan: FishExecScan, end: number, word: string) {
  if (!scan.commandStart || word !== 'builtin') return null
  let start = end
  while (scan.code[start] === ' ' || scan.code[start] === '\t') start += 1
  if (start === end) return null
  const next = tokenEnd(scan.code, start)
  return scan.code.slice(start, next) === 'eval' ? next : null
}

function visitWord(scan: FishExecScan) {
  const end = tokenEnd(scan.code, scan.index)
  const word = scan.code.slice(scan.index, end)
  const builtinEvalEnd = prefixedBuiltinEvalEnd(scan, end, word)
  if (builtinEvalEnd !== null) {
    wrapEval(scan, builtinEvalEnd)
    return
  }
  if (scan.commandStart && (word === 'exec' || word === '\\exec')) {
    scan.output += '__ow_capture_exec'
    scan.commandStart = false
    scan.index = end
    return
  }
  if (scan.commandStart && (word === 'eval' || word === '\\eval')) {
    wrapEval(scan, end)
    return
  }
  scan.output += word
  if (!COMMAND_PREFIXES.has(word) || !scan.commandStart) scan.commandStart = false
  scan.index = end
}

function visitBoundary(scan: FishExecScan, character: string) {
  if (character === ')' || character === '\n' || /[;|&<>]/.test(character)) closeEvalWrappers(scan)
  if (character === '(') {
    scan.enclosingCommandStarts.push(scan.commandStart)
    scan.parenDepth += 1
    scan.commandStart = true
  }
  if (character === ')') {
    scan.parenDepth = Math.max(0, scan.parenDepth - 1)
    scan.commandStart = scan.enclosingCommandStarts.pop() ?? true
  }
  if (character === '\n' || /[;|&()]/.test(character)) {
    if (character !== '(' && character !== ')') scan.commandStart = true
    scan.output += character
    scan.index += 1
    return true
  }
  if (character !== '<' && character !== '>') return false
  scan.output += character
  scan.index += 1
  return true
}

function visitCommentStart(scan: FishExecScan, character: string) {
  if (
    character !== '#' ||
    (scan.index !== 0 && !/[\s;|&()<>]/.test(scan.code[scan.index - 1] ?? ''))
  )
    return false
  closeEvalWrappers(scan)
  scan.comment = true
  scan.output += character
  scan.index += 1
  return true
}

function visitUnquoted(scan: FishExecScan) {
  const character = scan.code[scan.index] ?? ''
  if (character === '\\' && scan.code[scan.index + 1] === '\n') {
    scan.output += '\\\n'
    scan.index += ESCAPED_CHARACTER_LENGTH
    return
  }
  if (character === "'" || character === '"') {
    scan.quote = character
    scan.commandStart = false
    scan.output += character
    scan.index += 1
    return
  }
  if (visitBoundary(scan, character) || visitCommentStart(scan, character)) return
  if (/\s/.test(character)) {
    scan.output += character
    scan.index += 1
    return
  }
  visitWord(scan)
}

/** Fish reserves `exec` and `eval`, so helpers must be selected while parsing Setup text. */
export function captureFishExec(code: string): string {
  const scan: FishExecScan = {
    code,
    output: '',
    index: 0,
    commandStart: true,
    quote: null,
    comment: false,
    parenDepth: 0,
    enclosingCommandStarts: [],
    evalWrappers: [],
  }
  while (scan.index < code.length) {
    if (scan.comment) {
      visitComment(scan)
      continue
    }
    if (scan.quote) {
      visitQuote(scan)
      continue
    }
    visitUnquoted(scan)
  }
  closeEvalWrappers(scan)
  return scan.output
}
