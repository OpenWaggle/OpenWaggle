import type { Input, WebContents } from 'electron'

function hasPrimaryModifier(input: Input, isMac: boolean) {
  return isMac ? input.meta && !input.control : input.control && !input.meta
}

/** Editing belongs to the focused page; background automation cannot invoke host menu roles. */
export function isBrowserPreviewEditingShortcut(input: Input, platform = process.platform) {
  const isMac = platform === 'darwin'
  if (!hasPrimaryModifier(input, isMac)) return false
  const key = input.key.toLowerCase()
  if (isMac && input.alt && input.shift && input.code === 'KeyV') return true
  if (key === 'v' && input.shift) return input.alt === isMac
  if (input.alt) return false
  if (key === 'z') return !input.shift || platform !== 'win32'
  if (input.shift) return false
  return ['a', 'c', 'v', 'x'].includes(key) || (key === 'y' && platform === 'win32')
}

export function synchronizeBrowserPreviewEditingShortcuts(contents: WebContents, input: Input) {
  if (input.type !== 'keyDown') return
  contents.setIgnoreMenuShortcuts(!isBrowserPreviewEditingShortcut(input) || !contents.isFocused())
}
