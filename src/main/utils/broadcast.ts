import { getAllBrowserWindows } from '../desktop-ui'

/** Forward a message to all non-destroyed renderer windows. */
export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  try {
    for (const win of getAllBrowserWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
  } catch {
    // Electron windows may not be available in test environments
  }
}
