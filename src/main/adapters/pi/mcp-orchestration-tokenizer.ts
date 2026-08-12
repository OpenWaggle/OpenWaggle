import { MCP_CONFIG } from '@shared/constants/mcp'

export interface McpOrchestrationToken {
  readonly kind: 'identifier' | 'string' | 'number' | 'symbol' | 'eof'
  readonly value: string
  readonly offset: number
}

const SYMBOLS = [
  '===',
  '!==',
  '&&',
  '||',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  ';',
  ',',
  ':',
  '.',
  '!',
  '=',
]
const UNICODE_ESCAPE_DIGITS = 4
const HEXADECIMAL_RADIX = 16
const COMMENT_MARKER_LENGTH = 2
const ESCAPE_SEQUENCE_PREFIX_LENGTH = 2
const textEncoder = new TextEncoder()

function syntaxError(message: string, offset: number) {
  return new Error(`Invalid MCP orchestration syntax at offset ${String(offset)}: ${message}`)
}

function isIdentifierStart(character: string) {
  return /[A-Za-z_$]/u.test(character)
}

function isIdentifierPart(character: string) {
  return /[A-Za-z0-9_$]/u.test(character)
}

function unicodeEscape(source: string, offset: number) {
  const digits = source.slice(offset, offset + UNICODE_ESCAPE_DIGITS)
  if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) throw syntaxError('Invalid Unicode escape.', offset)
  return {
    value: String.fromCharCode(Number.parseInt(digits, HEXADECIMAL_RADIX)),
    length: UNICODE_ESCAPE_DIGITS,
  }
}

function escapedCharacter(source: string, offset: number) {
  const character = source[offset]
  if (!character) throw syntaxError('Unterminated string escape.', offset)
  if (character === 'u') return unicodeEscape(source, offset + 1)
  const escapes: Readonly<Record<string, string>> = {
    '"': '"',
    "'": "'",
    '\\': '\\',
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
  }
  const value = escapes[character]
  if (value === undefined) throw syntaxError(`Unsupported string escape \\${character}.`, offset)
  return { value, length: 0 }
}

function readString(source: string, start: number) {
  const quote = source[start]
  let value = ''
  let offset = start + 1
  while (offset < source.length) {
    const character = source[offset]
    if (character === quote) return { value, next: offset + 1 }
    if (character === '\n' || character === '\r')
      throw syntaxError('Strings cannot span lines.', offset)
    if (character === '\\') {
      const escaped = escapedCharacter(source, offset + 1)
      value += escaped.value
      offset += escaped.length + ESCAPE_SEQUENCE_PREFIX_LENGTH
      continue
    }
    value += character
    offset += 1
  }
  throw syntaxError('Unterminated string.', start)
}

function readNumber(source: string, start: number) {
  let offset = start
  while (offset < source.length && /[0-9eE+.-]/u.test(source[offset] ?? '')) offset += 1
  const value = source.slice(start, offset)
  if (!Number.isFinite(Number(value))) throw syntaxError(`Invalid number ${value}.`, start)
  return { value, next: offset }
}

function skipIgnored(source: string, start: number) {
  let offset = start
  while (offset < source.length) {
    if (/\s/u.test(source[offset] ?? '')) {
      offset += 1
      continue
    }
    if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset + COMMENT_MARKER_LENGTH)
      offset = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', offset)) {
      const end = source.indexOf('*/', offset + COMMENT_MARKER_LENGTH)
      if (end === -1) throw syntaxError('Unterminated block comment.', offset)
      offset = end + COMMENT_MARKER_LENGTH
      continue
    }
    break
  }
  return offset
}

export function tokenizeMcpOrchestration(source: string) {
  if (textEncoder.encode(source).byteLength > MCP_CONFIG.MAX_ORCHESTRATION_SOURCE_BYTES) {
    throw new Error(
      `MCP orchestration source exceeded ${String(MCP_CONFIG.MAX_ORCHESTRATION_SOURCE_BYTES)} bytes.`,
    )
  }
  const tokens: McpOrchestrationToken[] = []
  let offset = 0
  while (offset < source.length) {
    offset = skipIgnored(source, offset)
    if (offset >= source.length) break
    const character = source[offset] ?? ''
    if (character === '"' || character === "'") {
      const string = readString(source, offset)
      tokens.push({ kind: 'string', value: string.value, offset })
      offset = string.next
      continue
    }
    if (/[-0-9]/u.test(character)) {
      const number = readNumber(source, offset)
      tokens.push({ kind: 'number', value: number.value, offset })
      offset = number.next
      continue
    }
    if (isIdentifierStart(character)) {
      let end = offset + 1
      while (end < source.length && isIdentifierPart(source[end] ?? '')) end += 1
      tokens.push({ kind: 'identifier', value: source.slice(offset, end), offset })
      offset = end
      continue
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, offset))
    if (!symbol) throw syntaxError(`Forbidden or unsupported token ${character}.`, offset)
    tokens.push({ kind: 'symbol', value: symbol, offset })
    offset += symbol.length
  }
  tokens.push({ kind: 'eof', value: '', offset: source.length })
  return tokens
}
