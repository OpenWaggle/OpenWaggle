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
const COMBINING_GRAPHEME_JOINER = 0x034f
const HANGUL_CHOSEONG_FILLER = 0x115f
const HANGUL_JUNGSEONG_FILLER = 0x1160
const MONGOLIAN_VOWEL_SEPARATOR = 0x180e
const HANGUL_FILLER = 0x3164
const HALFWIDTH_HANGUL_FILLER = 0xffa0
const VARIATION_SELECTOR_SUPPLEMENT_START = 0xe0100
const VARIATION_SELECTOR_SUPPLEMENT_END = 0xe01ef
/**
 * A complete subdivision flag, such as Scotland's: the black flag, a lowercase region code
 * spelled in tag characters, and the cancel tag. Any other tag character is shown escaped.
 */
const SUBDIVISION_FLAG = /\u{1f3f4}[\u{e0030}-\u{e0039}\u{e0061}-\u{e007a}]{1,6}\u{e007f}/gu
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
const INVISIBLE_CHARACTERS: ReadonlySet<number> = new Set([
  SOFT_HYPHEN,
  COMBINING_GRAPHEME_JOINER,
  HANGUL_CHOSEONG_FILLER,
  HANGUL_JUNGSEONG_FILLER,
  MONGOLIAN_VOWEL_SEPARATOR,
  ZERO_WIDTH_SPACE,
  ZERO_WIDTH_NON_JOINER,
  HANGUL_FILLER,
  BYTE_ORDER_MARK,
  HALFWIDTH_HANGUL_FILLER,
])

function isInvisible(code: number) {
  return (
    INVISIBLE_CHARACTERS.has(code) ||
    (code >= WORD_JOINER && code <= INVISIBLE_PLUS) ||
    (code >= VARIATION_SELECTOR_SUPPLEMENT_START && code <= VARIATION_SELECTOR_SUPPLEMENT_END) ||
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

function sanitizeSegment(text: string) {
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

/**
 * Make agent-controlled text safe to print. Control characters, bidirectional-text controls,
 * and invisible characters are written out visibly rather than interpreted or deleted: an
 * approval message could otherwise move the cursor, rewrite the line being approved, reorder
 * its text, or hide part of a command. Line breaks and tabs are kept, CRLF becomes LF, and
 * complete subdivision flag emoji print as flags.
 */
export function sanitizeTerminalText(text: string) {
  let result = ''
  let start = 0
  for (const flag of text.matchAll(SUBDIVISION_FLAG)) {
    result += sanitizeSegment(text.slice(start, flag.index)) + flag[0]
    start = flag.index + flag[0].length
  }
  return result + sanitizeSegment(text.slice(start))
}
