/** Text that came from an agent or another client, made safe to print on a terminal. */
const DELETE = 0x7f
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const C0_END = 0x1f
const C1_START = 0x80
const C1_END = 0x9f
const HEX_RADIX = 16
const LAST_BYTE = 0xff
const BYTE_HEX_DIGITS = 2
const CODE_UNIT_HEX_DIGITS = 4
const ZERO_WIDTH_JOINER = '\u200d'
/** An emoji followed by one glyph selector or skin-tone modifier. */
const EMOJI_WITH_ATTACHMENT_LENGTH = 2

/**
 * Characters that render as nothing or change how their neighbours render: zero-width and
 * joiner characters, fillers, variation selectors, tag characters, and the bidirectional
 * marks, embeddings, and isolates (the Arabic letter mark and all bidi controls are included).
 */
const DEFAULT_IGNORABLE = /^[\p{Default_Ignorable_Code_Point}\u061c]$/u
const BIDI_CONTROL = /^\p{Bidi_Control}$/u
const EMOJI_PICTOGRAPH = /^\p{Extended_Pictographic}$/u
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u
/** The variation selectors that pick a text or emoji glyph for the character before them. */
const GLYPH_VARIATION_SELECTOR = /^[\ufe00-\ufe0f]$/u
/**
 * A complete subdivision flag, such as Scotland's: the black flag, a region and subdivision
 * code (three to six lowercase letters or digits) spelled in tag characters, and the cancel tag. Any other tag character is shown escaped.
 */
const SUBDIVISION_FLAG = /\u{1f3f4}[\u{e0030}-\u{e0039}\u{e0061}-\u{e007a}]{3,6}\u{e007f}/gu

function isControl(code: number) {
  if (code === TAB || code === LINE_FEED) return false
  return code <= C0_END || code === DELETE || (code >= C1_START && code <= C1_END)
}

/** A character written out, such as `\x1b`, `\u202e`, or `\u{e0041}`. */
function visibleEscape(code: number) {
  const hex = code.toString(HEX_RADIX)
  if (code <= LAST_BYTE) return `\\x${hex.padStart(BYTE_HEX_DIGITS, '0')}`
  return hex.length > CODE_UNIT_HEX_DIGITS
    ? `\\u{${hex}}`
    : `\\u${hex.padStart(CODE_UNIT_HEX_DIGITS, '0')}`
}

/** The emoji a joiner or modifier attaches to, skipping one glyph selector or modifier. */
function emojiBefore(characters: readonly string[], index: number) {
  const previous = characters[index - 1] ?? ''
  const attached = GLYPH_VARIATION_SELECTOR.test(previous) || EMOJI_MODIFIER.test(previous)
  const base = attached ? (characters[index - EMOJI_WITH_ATTACHMENT_LENGTH] ?? '') : previous
  return EMOJI_PICTOGRAPH.test(base)
}

/**
 * Whether an ignorable character is doing its visible job: a zero-width joiner between two
 * emoji (as in a family emoji), or one glyph selector right after a visible character (as in
 * a red heart). Anything else could hide data inside an approval line.
 */
function isRenderingJoin(characters: readonly string[], index: number) {
  const character = characters[index] ?? ''
  if (character === ZERO_WIDTH_JOINER) {
    return emojiBefore(characters, index) && EMOJI_PICTOGRAPH.test(characters[index + 1] ?? '')
  }
  if (!GLYPH_VARIATION_SELECTOR.test(character)) return false
  const previous = characters[index - 1] ?? ''
  return (
    previous !== '' && !DEFAULT_IGNORABLE.test(previous) && !isControl(previous.codePointAt(0) ?? 0)
  )
}

function isHidden(characters: readonly string[], index: number) {
  const character = characters[index] ?? ''
  if (BIDI_CONTROL.test(character)) return true
  return DEFAULT_IGNORABLE.test(character) && !isRenderingJoin(characters, index)
}

function sanitizeSegment(text: string) {
  const characters = [...text]
  let result = ''
  for (const [index, character] of characters.entries()) {
    const code = character.codePointAt(0) ?? 0
    if (code === CARRIAGE_RETURN && characters[index + 1] === '\n') continue
    const escaped = isControl(code) || isHidden(characters, index)
    result += escaped ? visibleEscape(code) : character
  }
  return result
}

/**
 * Make agent-controlled text safe to print. Control characters, bidirectional-text controls,
 * and invisible characters are written out visibly rather than interpreted or deleted: an
 * approval message could otherwise move the cursor, rewrite the line being approved, reorder
 * its text, or hide part of a command. Line breaks and tabs are kept, CRLF becomes LF, and
 * emoji (including joined sequences and subdivision flags) print as emoji.
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
