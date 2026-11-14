import { app, type BrowserWindow, type Input, type WebContents } from 'electron'

/**
 * The per-window shortcuts electron-toolkit's `optimizer.watchWindowShortcuts` installed, with its
 * defaults (no Escape-to-close, no zoom): F12 toggles DevTools in unpackaged builds, and packaged
 * builds swallow reload and the DevTools chords.
 */
function isReload(input: Input) {
  return input.code === 'KeyR' && (input.control || input.meta)
}

function isDevToolsChord(input: Input) {
  return input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift))
}

function isZoom(input: Input) {
  return (
    (input.code === 'Minus' && (input.control || input.meta)) ||
    (input.code === 'Equal' && input.shift && (input.control || input.meta))
  )
}

function toggleDevTools(webContents: WebContents) {
  if (webContents.isDevToolsOpened()) webContents.closeDevTools()
  else webContents.openDevTools({ mode: 'undocked' })
}

function watchWindowShortcuts(window: BrowserWindow) {
  const { webContents } = window
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (app.isPackaged && (isReload(input) || isDevToolsChord(input))) event.preventDefault()
    if (!app.isPackaged && input.code === 'F12') toggleDevTools(webContents)
    if (isZoom(input)) event.preventDefault()
  })
}

export function installElectronWindowShortcuts() {
  app.on('browser-window-created', (_, window) => watchWindowShortcuts(window))
}
