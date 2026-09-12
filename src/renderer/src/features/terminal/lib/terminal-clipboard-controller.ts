import type { Terminal } from '@xterm/xterm'
import type { TerminalInputEnqueueResult } from './terminal-input-dispatcher'
import {
  terminalClipboardShortcutAction,
  terminalCopyClearsSelection,
} from './terminal-native-keybindings'

interface TerminalClipboardControllerOptions {
  readonly terminal: Terminal
  readonly platform: string
  readonly readText: () => Promise<string>
  readonly writeText: (text: string) => void
  readonly enqueuePaste: (resolveData: () => Promise<string>) => Promise<TerminalInputEnqueueResult>
  readonly onError: (error: unknown) => void
}

/** Matches xterm's newline normalization and DECSET 2004 bracketed-paste encoding. */
export function prepareTerminalPasteData(text: string, bracketedPasteMode: boolean) {
  const normalized = text.replace(/\r?\n/gu, '\r')
  return bracketedPasteMode ? `\u001b[200~${normalized}\u001b[201~` : normalized
}

/** Delegates paste ordering to the runtime dispatcher so remounts cannot lose a pending read. */
export function createTerminalClipboardController(options: TerminalClipboardControllerOptions) {
  const { enqueuePaste, onError, platform, readText, terminal, writeText } = options
  const paste = () => {
    const bracketedPasteMode = terminal.modes.bracketedPasteMode
    terminal.focus()
    return enqueuePaste(async () => {
      let text: string
      try {
        text = await readText()
      } catch (cause) {
        throw new Error('Clipboard could not be read. Check system access and paste again.', {
          cause,
        })
      }
      return text.length === 0 ? '' : prepareTerminalPasteData(text, bracketedPasteMode)
    }).then((result) => {
      // A retired lifetime already owns its recovery notice. Its late clipboard
      // completion must not overwrite the currently attached terminal's UI.
      if (result.status === 'rejected' && result.reason !== 'inactive')
        throw new Error(result.error)
    })
  }

  const handleKey = (event: KeyboardEvent): boolean | null => {
    const action = terminalClipboardShortcutAction(event, platform)
    if (action === null) return null
    if (action === 'copy') {
      const selection = terminal.getSelection()
      if (selection.length === 0) return true
      event.preventDefault()
      try {
        writeText(selection)
      } catch (cause) {
        onError(
          new Error('Clipboard could not be written. Check system access and retry.', { cause }),
        )
        return false
      }
      if (terminalCopyClearsSelection(event, platform)) {
        terminal.clearSelection()
      }
      return false
    }
    event.preventDefault()
    void paste().catch(onError)
    return false
  }

  return { handleKey, paste }
}
