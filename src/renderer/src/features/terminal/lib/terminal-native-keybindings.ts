interface TerminalNativeKeyEvent {
  readonly type?: string
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly getModifierState?: (keyArg: string) => boolean
}

export type TerminalClipboardShortcutAction = 'copy' | 'paste'

const MAC_PLATFORM_PATTERN = /mac|darwin|iphone|ipad|ipod/iu
const CONTROL_CLEAR_SCREEN = '\u000c'
const CONTROL_DELETE_TO_LINE_START = '\u0015'
const CONTROL_LINE_START = '\u0001'
const CONTROL_LINE_END = '\u0005'
const ESCAPE_WORD_BACKWARD = '\u001bb'
const ESCAPE_WORD_FORWARD = '\u001bf'

function isMacPlatform(platform: string) {
  return MAC_PLATFORM_PATTERN.test(platform)
}

function isAltGraphPrintable(event: TerminalNativeKeyEvent) {
  return event.getModifierState?.('AltGraph') === true && [...event.key].length === 1
}

function hasOnlyControl(event: TerminalNativeKeyEvent) {
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

function hasOnlyMeta(event: TerminalNativeKeyEvent) {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}

function hasOnlyAlt(event: TerminalNativeKeyEvent) {
  return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
}

function isCopyGesture(event: TerminalNativeKeyEvent, key: string, isMac: boolean) {
  if (key !== 'c') return false
  return isMac ? event.metaKey : event.ctrlKey && !event.altKey && !event.metaKey
}

function isPasteGesture(event: TerminalNativeKeyEvent, key: string, isMac: boolean) {
  if (key === 'insert')
    return !isMac && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  if (key !== 'v') return false
  if (isMac) return event.metaKey
  return event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
}

/** T3-style plain Ctrl+C copies once, then releases the selection for the next SIGINT. */
export function terminalCopyClearsSelection(event: TerminalNativeKeyEvent, platform: string) {
  return (
    !isMacPlatform(platform) && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  )
}

/** Clipboard gestures that a canvas/terminal surface must own explicitly. */
export function terminalClipboardShortcutAction(
  event: TerminalNativeKeyEvent,
  platform: string,
): TerminalClipboardShortcutAction | null {
  if (event.type !== undefined && event.type !== 'keydown') return null
  if (isAltGraphPrintable(event)) return null
  const key = event.key.toLocaleLowerCase()
  const isMac = isMacPlatform(platform)
  if (isCopyGesture(event, key, isMac)) return 'copy'
  return isPasteGesture(event, key, isMac) ? 'paste' : null
}

function terminalEditingShortcutData(event: TerminalNativeKeyEvent, key: string, isMac: boolean) {
  if (key === 'l' && hasOnlyControl(event)) return CONTROL_CLEAR_SCREEN
  if (isMac && key === 'k' && hasOnlyMeta(event)) return CONTROL_CLEAR_SCREEN
  if (isMac && key === 'backspace' && hasOnlyMeta(event)) return CONTROL_DELETE_TO_LINE_START
  return null
}

function isWordMovement(event: TerminalNativeKeyEvent, isMac: boolean) {
  if (isMac) return hasOnlyAlt(event)
  return (
    !event.shiftKey &&
    !event.metaKey &&
    (event.altKey || event.ctrlKey) &&
    !(event.altKey && event.ctrlKey)
  )
}

function terminalNavigationShortcutData(
  event: TerminalNativeKeyEvent,
  key: string,
  isMac: boolean,
) {
  if (event.shiftKey || (key !== 'arrowleft' && key !== 'arrowright')) return null
  if (isMac && hasOnlyMeta(event)) {
    return key === 'arrowleft' ? CONTROL_LINE_START : CONTROL_LINE_END
  }
  if (!isWordMovement(event, isMac)) return null
  return key === 'arrowleft' ? ESCAPE_WORD_BACKWARD : ESCAPE_WORD_FORWARD
}

/** Maps desktop-native editing gestures to shell control sequences before xterm consumes them. */
export function terminalNativeShortcutData(
  event: TerminalNativeKeyEvent,
  platform: string,
): string | null {
  if (event.type !== undefined && event.type !== 'keydown') return null
  if (isAltGraphPrintable(event)) return null
  const key = event.key.toLocaleLowerCase()
  const isMac = isMacPlatform(platform)
  return (
    terminalEditingShortcutData(event, key, isMac) ??
    terminalNavigationShortcutData(event, key, isMac)
  )
}
