/** Text that came from an agent or another client, made safe to print on a terminal. */
const DELETE = 0x7f
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const C0_END = 0x1f
const C1_START = 0x80
const C1_END = 0x9f
const ARABIC_LETTER_MARK = 0x061c
const LEFT_TO_RIGHT_MARK = 0x200e
const RIGHT_TO_LEFT_MARK = 0x200f
const BIDI_EMBEDDING_START = 0x202a
const BIDI_EMBEDDING_END = 0x202e
const BIDI_ISOLATE_START = 0x2066
const BIDI_ISOLATE_END = 0x2069
const SOFT_HYPHEN = 0x00ad
const ZERO_WIDTH_SPACE = 0x200b
const ZERO_WIDTH_NON_JOINER = 0x200c
const WORD_JOINER = 0x2060
const INVISIBLE_PLUS = 0x2064
const BYTE_ORDER_MARK = 0xfeff
const TAG_START = 0xe0000
const TAG_END = 0xe007f
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
    code === ARABIC_LETTER_MARK ||
    code === LEFT_TO_RIGHT_MARK ||
    code === RIGHT_TO_LEFT_MARK ||
    (code >= BIDI_EMBEDDING_START && code <= BIDI_EMBEDDING_END) ||
    (code >= BIDI_ISOLATE_START && code <= BIDI_ISOLATE_END)
  )
}

/**
 * Characters that render as nothing, so text can hide inside an approval line. The zero-width
 * joiner stays, because emoji sequences need it.
 */
function isInvisible(code: number) {
  return (
    code === SOFT_HYPHEN ||
    code === ZERO_WIDTH_SPACE ||
    code === ZERO_WIDTH_NON_JOINER ||
    (code >= WORD_JOINER && code <= INVISIBLE_PLUS) ||
    code === BYTE_ORDER_MARK ||
    (code >= TAG_START && code <= TAG_END)
  )
}

/** A character written out, such as `\x1b`, `\u202e`, or `\u{e0041}`. */
function visibleEscape(code: number) {
  const hex = code.toString(HEX_RADIX)
  if (code <= LAST_BYTE) return `\\x${hex.padStart(BYTE_HEX_DIGITS, '0')}`
  return hex.length > CODE_UNIT_HEX_DIGITS
    ? `\\u{${hex}}`
    : `\\u${hex.padStart(CODE_UNIT_HEX_DIGITS, '0')}`
}

/**
 * Make agent-controlled text safe to print. Control characters and bidirectional-text
 * controls are written out visibly rather than interpreted or deleted: an approval message
 * could otherwise move the cursor, rewrite the line being approved, reorder its text, or
 * hide part of a command. Line breaks and tabs are kept, and CRLF becomes LF.
 */
export function sanitizeTerminalText(text: string) {
  const characters = [...text]
  let result = ''
  for (const [index, character] of characters.entries()) {
    const code = character.codePointAt(0) ?? 0
    if (code === CARRIAGE_RETURN && characters[index + 1] === '\n') continue
    const escaped = isControl(code) || isBidiControl(code) || isInvisible(code)
    result += escaped ? visibleEscape(code) : character
  }
  return result
}
