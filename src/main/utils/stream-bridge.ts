import type { ConversationId } from '@shared/types/brand'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { StreamChunk } from '@tanstack/ai'
import { BrowserWindow } from 'electron'

/**
 * Forward a raw TanStack AI StreamChunk to all renderer windows.
 * Used by the useChat IPC connection adapter in the renderer.
 */
export function emitStreamChunk(conversationId: ConversationId, chunk: StreamChunk): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      // StreamChunk may contain Error objects (RUN_ERROR) which don't serialize
      // well over IPC structured clone. Normalize before sending.
      // Preserve our custom `code` field for structured error classification.
      const serializable =
        chunk.type === 'RUN_ERROR'
          ? {
              ...chunk,
              error: {
                message: chunk.error.message,
                ...('code' in chunk.error && chunk.error.code ? { code: chunk.error.code } : {}),
              },
            }
          : chunk
      win.webContents.send('agent:stream-chunk', { conversationId, chunk: serializable })
    }
  }
}

export function emitOrchestrationEvent(payload: OrchestrationEventPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('orchestration:event', payload)
    }
  }
}
