/** A letter from a non-Latin script is what a Cyrillic, Greek, or Hebrew layout types anyway. */
const NON_LATIN_LETTER = /^(?=\p{L})(?!\p{Script=Latin})/u

/**
 * Whether a key press types a character with AltGr rather than pressing a shortcut. Windows
 * reports AltGr as Ctrl+Alt, so AltGr+L, which types `ł` on a Polish keyboard, would otherwise
 * match a Ctrl+Alt+L shortcut and never reach the text field. macOS has no AltGr: its Option
 * characters never count, so Cmd+Option shortcuts keep working.
 *
 * `altGraph` is the renderer's `getModifierState('AltGraph')`, which Chromium sets on Windows and
 * Linux. Main-process input has no such flag: on Windows pass `null`, so Ctrl+Alt without Meta
 * stands in for it, and elsewhere `false`, since Linux reports AltGr without Ctrl and Alt.
 *
 * With AltGr down, the press is typing when it produced one character that is not its key's own
 * letter or digit (`ł` from KeyL, not `l`). A letter of a non-Latin layout (`и` from KeyB) is not
 * an AltGr character, and neither is a Shift+digit symbol, whose layout varies. A key without a
 * letter or digit of its own counts only when the AltGr flag is known.
 */
export function typesAltGraphCharacter(input: {
  readonly key: string
  readonly code: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly altGraph: boolean | null
  readonly applePlatform: boolean
}) {
  if (input.applePlatform || [...input.key].length !== 1) return false
  const altGraph = input.altGraph ?? (input.ctrl && input.alt && !input.meta)
  if (!altGraph || NON_LATIN_LETTER.test(input.key)) return false
  const letter = /^Key([A-Z])$/.exec(input.code)?.[1]?.toLowerCase()
  if (letter !== undefined) return input.key.toLowerCase() !== letter
  const digit = /^Digit([0-9])$/.exec(input.code)?.[1]
  if (digit !== undefined) return !input.shift && input.key !== digit
  return input.altGraph === true
}
