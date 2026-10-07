import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Input, truncateToWidth } from '@earendil-works/pi-tui'

const KEEP_EXISTING_HELP = 'Existing value is prefilled. Edit it, or press Enter to keep it.'
const SUBMIT_HELP = 'enter submit  escape/ctrl+c cancel'
const BRACKETED_PASTE_START = '\u001b[200~'
const BRACKETED_PASTE_END = '\u001b[201~'

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
    // Entered as a bracketed paste, so the cursor ends after the value and typing appends to it;
    // `setValue` leaves the cursor at the start.
    textInput.handleInput(`${BRACKETED_PASTE_START}${input.currentValue}${BRACKETED_PASTE_END}`)

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
