import { terminalNativeShortcutData } from './terminal-native-keybindings'

interface TerminalCustomKeyHandlerOptions {
  readonly enqueueInput: (data: string) => void
  readonly handleClipboardKey: (event: KeyboardEvent) => boolean | null
  readonly platform: string
}

/** Keeps key presses owned outside xterm from leaking orphan Kitty key releases. */
export function createTerminalCustomKeyHandler(options: TerminalCustomKeyHandlerOptions) {
  const suppressedKeyups = new Set<string>()
  return (event: KeyboardEvent) => {
    if (event.type === 'keyup' && suppressedKeyups.delete(event.code)) return false
    const clipboardResult = options.handleClipboardKey(event)
    if (clipboardResult !== null) {
      if (!clipboardResult) suppressedKeyups.add(event.code)
      return clipboardResult
    }
    const data = terminalNativeShortcutData(event, options.platform)
    if (data === null) return true
    event.preventDefault()
    suppressedKeyups.add(event.code)
    options.enqueueInput(data)
    return false
  }
}
