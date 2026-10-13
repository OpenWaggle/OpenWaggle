import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Input, type KeybindingsManager, truncateToWidth } from '@earendil-works/pi-tui'

const KEEP_EXISTING_HELP = 'Existing value is prefilled. Edit it, or press Enter to keep it.'
const SUBMIT_HELP = 'enter submit  escape/ctrl+c cancel'
const ESC = '\u001b'
const BRACKETED_PASTE_START = `${ESC}[200~`
const BRACKETED_PASTE_END = `${ESC}[201~`
const LINE_END = 'tui.editor.cursorLineEnd'
const ALT_BIT = 2
const CTRL_BIT = 4
/** Ctrl+letter sends the letter's code with only its low five bits kept. */
const CONTROL_CHARACTER_MASK = 0x1f
const MODIFIER_BITS: Readonly<Record<string, number>> = { shift: 1, alt: ALT_BIT, ctrl: CTRL_BIT }
/** The terminal sequences Pi reads for the named keys a "line end" binding may use. */
const NAMED_KEY_SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  end: [`${ESC}[F`, `${ESC}OF`, `${ESC}[4~`],
  home: [`${ESC}[H`, `${ESC}OH`, `${ESC}[1~`],
  right: [`${ESC}[C`, `${ESC}OC`],
}

/** Terminal sequences a key id may arrive as, legacy and Kitty (CSI u) encodings. */
function keySequences(keyId: string): readonly string[] {
  const parts = keyId.split('+')
  const key = parts.at(-1) ?? ''
  const modifiers = parts.slice(0, -1)
  const bits = modifiers.reduce((sum, modifier) => sum + (MODIFIER_BITS[modifier] ?? 0), 0)
  const named = NAMED_KEY_SEQUENCES[key]
  if (named) {
    if (bits === 0) return named
    const final = named[0]?.at(-1) ?? ''
    return [`${ESC}[1;${bits + 1}${final}`]
  }
  if (key.length !== 1) return []
  const sequences = [`${ESC}[${key.codePointAt(0)};${bits + 1}u`]
  if (bits === 0) sequences.push(key)
  if (bits === ALT_BIT) sequences.push(`${ESC}${key}`)
  if (bits === CTRL_BIT && /^[a-z]$/u.test(key)) {
    sequences.push(String.fromCharCode((key.codePointAt(0) ?? 0) & CONTROL_CHARACTER_MASK))
  }
  return sequences
}

/** The input that moves Pi's input cursor to the line end, under the user's own keybindings. */
function lineEndInput(keybindings: KeybindingsManager) {
  for (const keyId of keybindings.getKeys(LINE_END)) {
    const sequence = keySequences(keyId).find((data) => keybindings.matches(data, LINE_END))
    if (sequence) return sequence
  }
  return undefined
}

export async function promptPrefilledText(input: {
  readonly ctx: ExtensionCommandContext
  readonly title: string
  readonly currentValue: string
}) {
  if (!input.ctx.hasUI) return input.currentValue

  if (typeof input.ctx.ui.custom !== 'function') {
    const next = await input.ctx.ui.input(input.title, input.currentValue)
    if (next === undefined) return null
    return next.trim() || input.currentValue
  }

  const next = await input.ctx.ui.custom<string | null>((_tui, theme, keybindings, done) => {
    const textInput = new Input()
    // `setValue` keeps the value exact and off the undo stack but leaves the cursor at the start;
    // moving to the line end, by whatever key the user bound to it, makes typing append to it.
    const moveToLineEnd = lineEndInput(keybindings)
    if (moveToLineEnd) {
      textInput.setValue(input.currentValue)
      textInput.handleInput(moveToLineEnd)
    } else {
      // No line-end key can be sent: entered as a paste instead, which leaves the cursor after it.
      textInput.handleInput(`${BRACKETED_PASTE_START}${input.currentValue}${BRACKETED_PASTE_END}`)
    }

    return {
      get focused() {
        return textInput.focused
      },
      set focused(value: boolean) {
        textInput.focused = value
      },
      render(width: number) {
        return [
          truncateToWidth(theme.fg('accent', input.title), width),
          '',
          ...textInput.render(width),
          '',
          truncateToWidth(theme.fg('dim', KEEP_EXISTING_HELP), width),
          truncateToWidth(theme.fg('dim', SUBMIT_HELP), width),
        ]
      },
      handleInput(data: string) {
        if (keybindings.matches(data, 'tui.select.confirm') || data === '\n') {
          done(textInput.getValue())
          return
        }
        if (keybindings.matches(data, 'tui.select.cancel')) {
          done(null)
          return
        }
        textInput.handleInput(data)
      },
      invalidate() {
        textInput.invalidate()
      },
    }
  })

  if (next === null) return null
  return next.trim() || input.currentValue
}
