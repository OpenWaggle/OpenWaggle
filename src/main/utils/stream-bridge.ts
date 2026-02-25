import type { ConversationId } from '@shared/types/brand'
import type { MultiAgentStreamMetadata, MultiAgentTurnEvent } from '@shared/types/multi-agent'
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
  const serializable = chunk.type === 'RUN_ERROR' ? serializeRunError(chunk) : chunk
  broadcastToWindows('agent:stream-chunk', { conversationId, chunk: serializable })
}

/**
 * Normalize a RUN_ERROR chunk for IPC serialization.
 * Preserves our custom `code` field for structured error classification,
 * plus `name`/`stack` when present on the runtime error object.
 */
function serializeRunError(chunk: StreamChunk & { type: 'RUN_ERROR' }): StreamChunk {
  const { error } = chunk
  return {
    ...chunk,
    error: {
      message: error.message,
      ...('name' in error && typeof error.name === 'string' ? { name: error.name } : {}),
      ...('stack' in error && typeof error.stack === 'string' ? { stack: error.stack } : {}),
      ...('code' in error && error.code ? { code: error.code } : {}),
    },
  }
}

export function emitOrchestrationEvent(payload: OrchestrationEventPayload): void {
  broadcastToWindows('orchestration:event', payload)
}

export function emitMultiAgentStreamChunk(
  conversationId: ConversationId,
  chunk: StreamChunk,
  meta: MultiAgentStreamMetadata,
): void {
  const serializable = chunk.type === 'RUN_ERROR' ? serializeRunError(chunk) : chunk
  broadcastToWindows('multi-agent:stream-chunk', { conversationId, chunk: serializable, meta })
}

export function emitMultiAgentTurnEvent(
  conversationId: ConversationId,
  event: MultiAgentTurnEvent,
): void {
  broadcastToWindows('multi-agent:turn-event', { conversationId, event })
}
