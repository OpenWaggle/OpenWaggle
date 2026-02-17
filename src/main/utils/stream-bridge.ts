import type { StreamChunk } from '@tanstack/ai'
import { BrowserWindow } from 'electron'

/**
 * Forward a raw TanStack AI StreamChunk to all renderer windows.
 * Used by the useChat IPC connection adapter in the renderer.
 */
export function emitStreamChunk(chunk: StreamChunk): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      // StreamChunk may contain Error objects (RUN_ERROR) which don't serialize
      // well over IPC structured clone. Normalize before sending.
      const serializable =
        chunk.type === 'RUN_ERROR' ? { ...chunk, error: { message: chunk.error.message } } : chunk
      win.webContents.send('agent:stream-chunk', serializable)
    }
  }
}
