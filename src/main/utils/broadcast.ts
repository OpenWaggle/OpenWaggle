import { BrowserWindow } from 'electron'

/** Forward a message to all non-destroyed renderer windows. */
export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
  } catch {
    // BrowserWindow may not be available in test environments
  }
}
