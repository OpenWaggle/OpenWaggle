import type { ActiveRunInfo, BackgroundRunSnapshot, RunMode } from '@shared/types/background-run'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { AgentPhaseEventPayload } from '@shared/types/phase'
import type { WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
import type { StreamChunk } from '@tanstack/ai'
import {
  resetPhaseForConversation,
  updatePhaseFromOrchestrationEvent,
  updatePhaseFromStreamChunk,
} from '../agent/phase-tracker'
import { StreamPartCollector } from '../agent/stream-part-collector'
import { broadcastToWindows } from './broadcast'

// ─── Stream Buffer (Background Run Tracking) ────────────────

interface ActiveStreamBuffer {
  readonly collector: StreamPartCollector
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
}

const activeBuffers = new Map<ConversationId, ActiveStreamBuffer>()

/** Called by handlers at run start to begin buffering stream parts. */
export function startStreamBuffer(
  conversationId: ConversationId,
  model: SupportedModelId,
  mode: RunMode,
): void {
  activeBuffers.set(conversationId, {
    collector: new StreamPartCollector(),
    model,
    mode,
    startedAt: Date.now(),
  })
}

/** Called by handlers in finally blocks to clean up the buffer. */
export function clearStreamBuffer(conversationId: ConversationId): void {
  activeBuffers.delete(conversationId)
}

/** Returns a full snapshot for reconnection, or null if no active run. */
export function getStreamBuffer(conversationId: ConversationId): BackgroundRunSnapshot | null {
  const buffer = activeBuffers.get(conversationId)
  if (!buffer) return null
  return {
    conversationId,
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    parts: buffer.collector.snapshotParts(),
  }
}

/** Returns lightweight info for all active runs (no message content). */
export function listStreamBuffers(): ActiveRunInfo[] {
  const result: ActiveRunInfo[] = []
  for (const [conversationId, buffer] of activeBuffers) {
    result.push({
      conversationId,
      model: buffer.model,
      mode: buffer.mode,
      startedAt: buffer.startedAt,
    })
  }
  return result
}

/** Broadcasts run-completed event to all renderer windows. */
export function emitRunCompleted(conversationId: ConversationId): void {
  broadcastToWindows('agent:run-completed', { conversationId })
}

// ─── Stream Chunk Emission ──────────────────────────────────

/**
 * Forward a raw TanStack AI StreamChunk to all renderer windows.
 * Used by the useChat IPC connection adapter in the renderer.
 * Also pushes chunks to the per-conversation buffer for background run support.
 */
export function emitStreamChunk(conversationId: ConversationId, chunk: StreamChunk): void {
  // StreamChunk may contain Error objects (RUN_ERROR) which don't serialize
  // well over IPC structured clone. Normalize before sending.
  const serializable = chunk.type === 'RUN_ERROR' ? serializeRunError(chunk) : chunk

  // Feed the buffer's collector so reconnecting renderers can snapshot progress.
  const buffer = activeBuffers.get(conversationId)
  if (buffer) {
    buffer.collector.handleChunk(serializable)
  }

  maybeEmitPhase({
    conversationId,
    phase: updatePhaseFromStreamChunk(conversationId, serializable, Date.now()),
  })
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
  maybeEmitPhase({
    conversationId: payload.conversationId,
    phase: updatePhaseFromOrchestrationEvent(payload, Date.now()),
  })
  broadcastToWindows('orchestration:event', payload)
}

export function emitWaggleStreamChunk(
  conversationId: ConversationId,
  chunk: StreamChunk,
  meta: WaggleStreamMetadata,
): void {
  const serializable = chunk.type === 'RUN_ERROR' ? serializeRunError(chunk) : chunk
  broadcastToWindows('waggle:stream-chunk', { conversationId, chunk: serializable, meta })
}

export function emitWaggleTurnEvent(conversationId: ConversationId, event: WaggleTurnEvent): void {
  broadcastToWindows('waggle:turn-event', { conversationId, event })
}

export function emitContextInjected(
  conversationId: ConversationId,
  text: string,
  timestamp: number,
): void {
  broadcastToWindows('agent:context-injected', { conversationId, text, timestamp })
}

export function clearAgentPhase(conversationId: ConversationId): void {
  const result = resetPhaseForConversation(conversationId)
  if (!result.changed) return
  broadcastToWindows('agent:phase', { conversationId, phase: null })
}

function maybeEmitPhase(input: {
  conversationId: ConversationId
  phase: { changed: boolean; phase: AgentPhaseEventPayload['phase'] }
}): void {
  if (!input.phase.changed) return
  broadcastToWindows('agent:phase', {
    conversationId: input.conversationId,
    phase: input.phase.phase,
  })
}
