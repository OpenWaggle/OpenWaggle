import type { ConversationId } from '@shared/types/brand'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { StreamChunk } from '@tanstack/ai'
import { broadcastToWindows } from './broadcast'

/**
 * Forward a raw TanStack AI StreamChunk to all renderer windows.
 * Used by the useChat IPC connection adapter in the renderer.
 */
export function emitStreamChunk(conversationId: ConversationId, chunk: StreamChunk): void {
  // StreamChunk may contain Error objects (RUN_ERROR) which don't serialize
  // well over IPC structured clone. Normalize before sending.
  // Preserve our custom `code` field for structured error classification.
  const serializable =
    chunk.type === 'RUN_ERROR'
      ? {
          ...chunk,
          error: {
            message: chunk.error.message,
            ...('name' in chunk.error ? { name: (chunk.error as { name?: string }).name } : {}),
            ...('stack' in chunk.error ? { stack: (chunk.error as { stack?: string }).stack } : {}),
            ...('code' in chunk.error && chunk.error.code ? { code: chunk.error.code } : {}),
          },
        }
      : chunk
  broadcastToWindows('agent:stream-chunk', { conversationId, chunk: serializable })
}

export function emitOrchestrationEvent(payload: OrchestrationEventPayload): void {
  broadcastToWindows('orchestration:event', payload)
}
