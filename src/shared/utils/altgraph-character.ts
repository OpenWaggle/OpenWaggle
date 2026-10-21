/**
 * Whether a key press types a character with AltGr rather than pressing a shortcut. Windows and
 * Linux report AltGr as Ctrl+Alt, so AltGr+L, which types `ł` on a Polish keyboard, would
 * otherwise match a Ctrl+Alt+L shortcut and never reach the text field. macOS has no AltGr: its
 * Option characters never count, so Cmd+Option shortcuts keep working.
 *
 * The press is typing when it produced one character that is not the key's own letter or digit:
 * AltGr+L gives `ł`, while Ctrl+Alt+L on a layout without an AltGr character there gives `l`.
 * `altGraph` is the renderer's `getModifierState('AltGraph')`; main-process input has no such
 * flag (`null`), so there Ctrl+Alt without Meta stands in for it.
 */
export function typesAltGraphCharacter(input: {
  readonly key: string
  readonly code: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly altGraph: boolean | null
  readonly applePlatform: boolean
}) {
  if (input.applePlatform || [...input.key].length !== 1) return false
  const altGraph = input.altGraph ?? (input.ctrl && input.alt && !input.meta)
  if (!altGraph) return false
  const base =
    /^Key([A-Z])$/.exec(input.code)?.[1]?.toLowerCase() ?? /^Digit([0-9])$/.exec(input.code)?.[1]
  // A key without a letter or digit of its own (punctuation) types whatever AltGr gives it.
  return base === undefined || input.key.toLowerCase() !== base
}
