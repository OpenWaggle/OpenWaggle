/** A letter from a non-Latin script is what a Cyrillic, Greek, or Hebrew layout types anyway. */
const NON_LATIN_LETTER = /^(?=\p{L})(?!\p{Script=Latin})/u
/** Every Latin layout's base keys type ASCII letters and digits, wherever it puts them. */
const ASCII_LETTER_OR_DIGIT = /^[A-Za-z0-9]$/
const ASCII = /^[\u0020-\u007e]$/

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
 * With AltGr down, the press is typing when it produced a character other than the one its key
 * types on this layout. `layoutKey` is that base character when the keyboard layout is known
 * (the renderer's Keyboard API layout map), so AZERTY's `a` on KeyQ is the key's own letter.
 * Without it, an ASCII letter or digit is never AltGr output, and a symbol counts only when the
 * AltGr flag is known or the symbol is outside ASCII (`€`), since `@` or `&` may be a base key.
 * A non-Latin letter (`и`) and a Shift+digit symbol, whose layout varies, never count.
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
  readonly layoutKey?: string | null
}) {
  if (input.applePlatform || [...input.key].length !== 1) return false
  const altGraph = input.altGraph ?? (input.ctrl && input.alt && !input.meta)
  if (!altGraph || NON_LATIN_LETTER.test(input.key)) return false
  if (input.shift && /^Digit[0-9]$/.test(input.code)) return false
  if (input.layoutKey) return input.key.toLowerCase() !== input.layoutKey.toLowerCase()
  if (ASCII_LETTER_OR_DIGIT.test(input.key)) return false
  return input.altGraph === true || !ASCII.test(input.key)
}
