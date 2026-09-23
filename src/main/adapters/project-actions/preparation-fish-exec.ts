const COMMAND_PREFIXES = new Set(['and', 'if', 'not', 'or', 'time', 'while'])
const ESCAPED_CHARACTER_LENGTH = 2

interface FishExecScan {
  readonly code: string
  output: string
  index: number
  commandStart: boolean
  quote: "'" | '"' | null
  comment: boolean
}

function tokenEnd(code: string, start: number) {
  let end = start
  while (end < code.length && !/[\s;|&()]/.test(code[end] ?? '')) end += 1
  return end
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

function visitWord(scan: FishExecScan) {
  const end = tokenEnd(scan.code, scan.index)
  const word = scan.code.slice(scan.index, end)
  if (scan.commandStart && (word === 'exec' || word === '\\exec')) {
    scan.output += '__ow_capture_exec'
    scan.commandStart = false
  } else {
    scan.output += word
    if (!COMMAND_PREFIXES.has(word) || !scan.commandStart) scan.commandStart = false
  }
  scan.index = end
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
  if (character === '\n' || /[;|&()]/.test(character)) {
    scan.commandStart = true
    scan.output += character
    scan.index += 1
    return
  }
  if (
    character === '#' &&
    (scan.index === 0 || /[\s;|&()]/.test(scan.code[scan.index - 1] ?? ''))
  ) {
    scan.comment = true
    scan.output += character
    scan.index += 1
    return
  }
  if (/\s/.test(character)) {
    scan.output += character
    scan.index += 1
    return
  }
  visitWord(scan)
}

/** Fish reserves `exec`, so the capture helper must be selected while parsing Setup text. */
export function captureFishExec(code: string): string {
  const scan: FishExecScan = {
    code,
    output: '',
    index: 0,
    commandStart: true,
    quote: null,
    comment: false,
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
  return scan.output
}
