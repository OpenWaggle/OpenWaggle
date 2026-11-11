/**
 * The window shortcuts on Electrobun (ADR 0064). The system webviews bind no reload, DevTools or
 * zoom keys of their own (Electron's Chromium does, which is why its shortcuts swallow them), so
 * the only shortcut left is F12 toggling DevTools in unpackaged builds: the Electrobun preload
 * sends `shell:toggle-devtools` on F12, and windows opened after this was installed act on it.
 */
const installed = { value: false }

export function installElectrobunWindowShortcuts() {
  installed.value = true
}

export function windowShortcutsInstalled() {
  return installed.value
}
