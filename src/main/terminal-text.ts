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
 * joiner characters, fillers, variation selectors, tag characters, bidi marks, other format
 * characters, and the line and paragraph separators.
 */
const INVISIBLE = /^[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Zl}\p{Zp}]$/u
const BIDI_CONTROL = /^\p{Bidi_Control}$/u
const EMOJI = /^\p{Emoji}$/u
const EMOJI_PICTOGRAPH = /^\p{Extended_Pictographic}$/u
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u
/** The selectors that pick the text or the emoji glyph of the emoji before them. */
const EMOJI_PRESENTATION_SELECTOR = /^[\ufe0e\ufe0f]$/u
/**
 * A letter of a script whose words use ZWJ/ZWNJ to control joining or conjuncts: Arabic,
 * Syriac, N'Ko, Mongolian, and the Indic scripts.
 */
const JOINING_SCRIPT_LETTER =
  /^(?=\p{L})[\p{sc=Arab}\p{sc=Syrc}\p{sc=Nkoo}\p{sc=Mong}\p{sc=Deva}\p{sc=Beng}\p{sc=Guru}\p{sc=Gujr}\p{sc=Orya}\p{sc=Taml}\p{sc=Telu}\p{sc=Knda}\p{sc=Mlym}\p{sc=Sinh}]$/u
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u
const MARK = /^\p{M}$/u
/** Digits, `#`, and `*` are emoji only as keycaps, with a selector and the keycap mark. */
const KEYCAP_BASE = /^[0-9#*]$/u
const COMBINING_KEYCAP = '\u20e3'
const ZERO_WIDTH_NON_JOINER = '\u200c'
/** The subdivision flags Unicode recommends: England, Scotland, and Wales. */
const SUBDIVISION_FLAG =
  /\u{1f3f4}(?:\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}|\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}|\u{e0067}\u{e0062}\u{e0077}\u{e006c}\u{e0073})\u{e007f}/gu

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

/** The emoji a joiner attaches to, skipping one presentation selector or skin-tone modifier. */
function emojiBefore(characters: readonly string[], index: number) {
  const previous = characters[index - 1] ?? ''
  const attached = EMOJI_PRESENTATION_SELECTOR.test(previous) || EMOJI_MODIFIER.test(previous)
  const base = attached ? (characters[index - EMOJI_WITH_ATTACHMENT_LENGTH] ?? '') : previous
  return EMOJI_PICTOGRAPH.test(base)
}

/** The nearest letter from `index` in direction `step`, skipping combining marks. */
function nearestLetter(characters: readonly string[], index: number, step: 1 | -1) {
  let position = index + step
  while (MARK.test(characters[position] ?? '')) position += step
  return characters[position] ?? ''
}

/** A joiner between visible letters or marks of a word in a script that uses joiners. */
function isInsideJoiningWord(characters: readonly string[], index: number) {
  const touchesText =
    LETTER_OR_MARK.test(characters[index - 1] ?? '') &&
    LETTER_OR_MARK.test(characters[index + 1] ?? '')
  return (
    touchesText &&
    JOINING_SCRIPT_LETTER.test(nearestLetter(characters, index, -1)) &&
    JOINING_SCRIPT_LETTER.test(nearestLetter(characters, index, 1))
  )
}

/**
 * Whether an invisible character is doing its visible job: a zero-width joiner between two
 * emoji (as in a family emoji), a joiner or non-joiner inside a word of a script that uses
 * them, or one presentation selector right after an emoji (as in a red heart or a keycap).
 * Anything else could hide data inside an approval line.
 */
function isRenderingJoin(characters: readonly string[], index: number) {
  const character = characters[index] ?? ''
  const previous = characters[index - 1] ?? ''
  const next = characters[index + 1] ?? ''
  if (character === ZERO_WIDTH_JOINER || character === ZERO_WIDTH_NON_JOINER) {
    const joinsEmoji =
      character === ZERO_WIDTH_JOINER &&
      emojiBefore(characters, index) &&
      EMOJI_PICTOGRAPH.test(next)
    return joinsEmoji || isInsideJoiningWord(characters, index)
  }
  if (!EMOJI_PRESENTATION_SELECTOR.test(character)) return false
  return KEYCAP_BASE.test(previous) ? next === COMBINING_KEYCAP : EMOJI.test(previous)
}

function isHidden(characters: readonly string[], index: number) {
  const character = characters[index] ?? ''
  if (BIDI_CONTROL.test(character)) return true
  return INVISIBLE.test(character) && !isRenderingJoin(characters, index)
}

/** `following` is text that comes next; it informs neighbour checks but is not written. */
function sanitizeSegment(text: string, following: string) {
  const own = [...text]
  const characters = [...own, ...following]
  let result = ''
  for (const [index, character] of own.entries()) {
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
 * emoji (including joined sequences and subdivision flags) print as emoji. Pass the text
 * that follows, when it is known, so a joiner at the end is judged by its real neighbour.
 */
export function sanitizeTerminalText(text: string, following = '') {
  let result = ''
  let start = 0
  for (const flag of text.matchAll(SUBDIVISION_FLAG)) {
    result += sanitizeSegment(text.slice(start, flag.index), flag[0]) + flag[0]
    start = flag.index + flag[0].length
  }
  return result + sanitizeSegment(text.slice(start), following)
}
