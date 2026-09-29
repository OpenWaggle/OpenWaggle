/** Text that came from an agent or another client, made safe to print on a terminal. */
const DELETE = 0x7f
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const C0_END = 0x1f
const C1_START = 0x80
const C1_END = 0x9f
const LEFT_TO_RIGHT_MARK = 0x200e
const RIGHT_TO_LEFT_MARK = 0x200f
const BIDI_EMBEDDING_START = 0x202a
const BIDI_EMBEDDING_END = 0x202e
const BIDI_ISOLATE_START = 0x2066
const BIDI_ISOLATE_END = 0x2069
const HEX_RADIX = 16
const LAST_BYTE = 0xff
const BYTE_HEX_DIGITS = 2
const CODE_UNIT_HEX_DIGITS = 4

function isControl(code: number) {
  if (code === TAB || code === LINE_FEED) return false
  return code <= C0_END || code === DELETE || (code >= C1_START && code <= C1_END)
}

/** Characters that reorder the text around them, so what is shown differs from what is sent. */
function isBidiControl(code: number) {
  return (
    code === LEFT_TO_RIGHT_MARK ||
    code === RIGHT_TO_LEFT_MARK ||
    (code >= BIDI_EMBEDDING_START && code <= BIDI_EMBEDDING_END) ||
    (code >= BIDI_ISOLATE_START && code <= BIDI_ISOLATE_END)
  )
}

/** A control character written out, such as `\x1b` or `\u202e`. */
function visibleEscape(code: number) {
  const hex = code.toString(HEX_RADIX)
  return code <= LAST_BYTE
    ? `\\x${hex.padStart(BYTE_HEX_DIGITS, '0')}`
    : `\\u${hex.padStart(CODE_UNIT_HEX_DIGITS, '0')}`
}

/**
 * Make agent-controlled text safe to print. Control characters and bidirectional-text
 * controls are written out visibly rather than interpreted or deleted: an approval message
 * could otherwise move the cursor, rewrite the line being approved, reorder its text, or
 * hide part of a command. Line breaks and tabs are kept, and CRLF becomes LF.
 */
export function sanitizeTerminalText(text: string) {
  let result = ''
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED) continue
    result += isControl(code) || isBidiControl(code) ? visibleEscape(code) : text[index]
  }
  return result
}
