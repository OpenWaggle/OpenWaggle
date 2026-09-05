import { matchBy } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import type {
  ActiveRunInfo,
  BackgroundRunSnapshot,
  RunMode,
  WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { AgentTransportEvent } from '@shared/types/stream'
import { retainedBytesAfterTextAppend, retainedPartsBytes } from './stream-buffer-byte-accounting'
import {
  appendReasoningPart,
  appendTextPart,
  upsertToolCallPart,
} from './stream-buffer-message-parts'
import {
  type ActiveStreamBuffer,
  exceedsStreamBufferLimit,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  MAX_DEGRADED_TOOL_CALL_IDS,
  MAX_TOTAL_STREAM_BUFFER_BYTES,
  restoreStreamBufferSnapshots,
  retainDegradedToolCallId,
  retainedStreamBufferBytes,
  toStreamBufferSnapshot,
  withoutRetainedStreamContent,
  withWorktreeLaunchSnapshot,
} from './stream-buffer-snapshots'
import { applyToolExecutionEndToParts } from './stream-buffer-tool-parts'

export { MAX_ACTIVE_STREAM_BUFFER_BYTES, MAX_DEGRADED_TOOL_CALL_IDS, MAX_TOTAL_STREAM_BUFFER_BYTES }

const activeBuffers = new Map<SessionId, ActiveStreamBuffer>()
// The Local Session protocol sends all active snapshots in one 8 MiB frame.
// Keep enough headroom for JSON structure, model metadata, and frame fields.
let totalRetainedBytes = 0

function resetBufferedParts(sessionId: SessionId) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  totalRetainedBytes = Math.max(0, totalRetainedBytes - retainedStreamBufferBytes(buffer))
  activeBuffers.set(sessionId, withoutRetainedStreamContent(buffer))
}

function updateBufferedParts(
  sessionId: SessionId,
  update: (parts: readonly MessagePart[]) => readonly MessagePart[],
  attemptedContentBytes?: number,
) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  const parts = update(buffer.parts)
  const retainedBytes = retainedPartsBytes(parts)
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    activeBuffers.set(sessionId, {
      ...buffer,
      omittedBytes: buffer.omittedBytes + (attemptedContentBytes ?? Math.max(0, retainedDelta)),
    })
    return
  }
  totalRetainedBytes += retainedDelta
  activeBuffers.set(sessionId, {
    ...buffer,
    parts,
    retainedBytes,
  })
}

function appendBufferedToolCallDelta(
  sessionId: SessionId,
  input: { readonly toolCallId: string; readonly delta: string; readonly args: JsonValue },
) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  const deltaBytes = Buffer.byteLength(input.delta, 'utf8')
  if (buffer.degradedToolCallIds.has(input.toolCallId)) {
    activeBuffers.set(sessionId, {
      ...buffer,
      omittedBytes: buffer.omittedBytes + deltaBytes,
    })
    return
  }
  const parts = upsertToolCallPart({
    parts: buffer.parts,
    toolCallId: input.toolCallId,
    args: input.args,
  })
  const hasExistingPart = buffer.parts.some(
    (part) => part.type === 'tool-call' && String(part.toolCall.id) === input.toolCallId,
  )
  const retainedBytes = hasExistingPart
    ? buffer.retainedBytes + deltaBytes
    : retainedPartsBytes(parts)
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    const degraded = retainDegradedToolCallId(buffer, input.toolCallId, totalRetainedBytes)
    totalRetainedBytes += degraded.retainedDelta
    activeBuffers.set(sessionId, {
      ...degraded.buffer,
      omittedBytes: buffer.omittedBytes + deltaBytes,
    })
    return
  }
  totalRetainedBytes += retainedDelta
  activeBuffers.set(sessionId, { ...buffer, parts, retainedBytes })
}

function appendBufferedText(sessionId: SessionId, type: 'text' | 'reasoning', delta: string) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  const parts =
    type === 'text' ? appendTextPart(buffer.parts, delta) : appendReasoningPart(buffer.parts, delta)
  const retainedBytes = retainedBytesAfterTextAppend({
    parts: buffer.parts,
    retainedBytes: buffer.retainedBytes,
    type,
    delta,
  })
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    activeBuffers.set(sessionId, {
      ...buffer,
      omittedBytes: buffer.omittedBytes + Buffer.byteLength(delta, 'utf8'),
    })
    return
  }
  totalRetainedBytes += retainedDelta
  activeBuffers.set(sessionId, { ...buffer, parts, retainedBytes })
}

function updateBufferedAssistantMessageId(sessionId: SessionId, messageId: string) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  activeBuffers.set(sessionId, {
    ...buffer,
    messageId,
  })
}

function applyMessageUpdateToStreamBuffer(
  sessionId: SessionId,
  value: Extract<AgentTransportEvent, { type: 'message_update' }>,
) {
  updateBufferedAssistantMessageId(sessionId, value.messageId)
  matchBy(value.assistantMessageEvent, 'type')
    .with('text_start', 'text_end', 'thinking_start', 'thinking_end', () => undefined)
    .with('text_delta', (assistantEvent) => {
      appendBufferedText(sessionId, 'text', assistantEvent.delta)
    })
    .with('thinking_delta', (assistantEvent) => {
      appendBufferedText(sessionId, 'reasoning', assistantEvent.delta)
    })
    .with('toolcall_start', (assistantEvent) => {
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: assistantEvent.toolCallId,
          toolName: assistantEvent.toolName,
          args: assistantEvent.input,
        }),
      )
    })
    .with('toolcall_end', (assistantEvent) => {
      if (activeBuffers.get(sessionId)?.degradedToolCallIds.has(assistantEvent.toolCallId)) return
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: assistantEvent.toolCallId,
          toolName: assistantEvent.toolName,
          args: assistantEvent.input,
        }),
      )
    })
    .with('toolcall_delta', (assistantEvent) => {
      if (assistantEvent.input !== undefined) {
        appendBufferedToolCallDelta(sessionId, {
          toolCallId: assistantEvent.toolCallId,
          delta: assistantEvent.delta,
          args: assistantEvent.input,
        })
      }
    })
    .with('done', 'error', () => undefined)
    .exhaustive()
}

export function applyEventToStreamBuffer(sessionId: SessionId, event: AgentTransportEvent) {
  matchBy(event, 'type')
    .with('agent_start', 'agent_end', 'turn_start', 'turn_end', () => undefined)
    .with('message_start', (value) => {
      if (value.role === 'assistant') {
        updateBufferedAssistantMessageId(sessionId, value.messageId)
        resetBufferedParts(sessionId)
      }
    })
    .with('message_update', (value) => applyMessageUpdateToStreamBuffer(sessionId, value))
    .with('message_end', () => undefined)
    .with('tool_execution_start', 'tool_execution_update', (value) => {
      if (activeBuffers.get(sessionId)?.degradedToolCallIds.has(value.toolCallId)) return
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: value.toolCallId,
          toolName: value.toolName,
          args: value.args,
        }),
      )
    })
    .with('tool_execution_end', (value) => {
      const preserveArgs = activeBuffers.get(sessionId)?.degradedToolCallIds.has(value.toolCallId)
      updateBufferedParts(sessionId, (parts) =>
        applyToolExecutionEndToParts(parts, value, preserveArgs),
      )
    })
    .with(
      'queue_update',
      'compaction_start',
      'compaction_end',
      'auto_retry_start',
      'auto_retry_end',
      'custom',
      'agent_interaction_request',
      'agent_interaction_resolved',
      () => undefined,
    )
    .exhaustive()
}

export function startStreamBuffer(sessionId: SessionId, model: SupportedModelId, mode: RunMode) {
  clearStreamBuffer(sessionId)
  activeBuffers.set(sessionId, {
    model,
    mode,
    startedAt: Date.now(),
    parts: [],
    retainedBytes: 0,
    omittedBytes: 0,
    degradedToolCallIds: new Set(),
    degradedToolCallIdsBytes: 0,
  })
}

export function startStreamBufferFromAgentStart(
  sessionId: SessionId,
  event: Extract<AgentTransportEvent, { type: 'agent_start' }>,
) {
  const existing = activeBuffers.get(sessionId)
  const model = event.model
    ? SupportedModelId(event.model)
    : (existing?.model ?? SupportedModelId(''))
  const mode = event.runId.startsWith('waggle-') ? 'waggle' : 'classic'
  activeBuffers.set(
    sessionId,
    existing
      ? { ...existing, model, mode }
      : {
          model,
          mode,
          startedAt: event.timestamp,
          parts: [],
          retainedBytes: 0,
          omittedBytes: 0,
          degradedToolCallIds: new Set(),
          degradedToolCallIdsBytes: 0,
        },
  )
}

export function clearStreamBuffer(sessionId: SessionId) {
  const buffer = activeBuffers.get(sessionId)
  if (buffer) {
    totalRetainedBytes = Math.max(0, totalRetainedBytes - retainedStreamBufferBytes(buffer))
  }
  activeBuffers.delete(sessionId)
}

export function setWorktreeLaunchSnapshot(
  sessionId: SessionId,
  snapshot: WorktreeLaunchSnapshot | null,
) {
  const updated = withWorktreeLaunchSnapshot(activeBuffers.get(sessionId), snapshot)
  if (updated) activeBuffers.set(sessionId, updated)
}

export function getStreamBuffer(sessionId: SessionId): BackgroundRunSnapshot | null {
  return toStreamBufferSnapshot(sessionId, activeBuffers.get(sessionId))
}

export function listStreamBuffers(): ActiveRunInfo[] {
  const result: ActiveRunInfo[] = []
  for (const [sessionId, buffer] of activeBuffers) {
    result.push({
      sessionId,
      model: buffer.model,
      mode: buffer.mode,
      startedAt: buffer.startedAt,
    })
  }
  return result
}

export function listStreamBufferSnapshots(): BackgroundRunSnapshot[] {
  return [...activeBuffers.keys()].flatMap((sessionId) => {
    const snapshot = getStreamBuffer(sessionId)
    return snapshot ? [snapshot] : []
  })
}

export function replaceStreamBufferSnapshots(snapshots: readonly BackgroundRunSnapshot[]) {
  const restored = restoreStreamBufferSnapshots(activeBuffers, snapshots)
  totalRetainedBytes = restored.totalRetainedBytes
  return restored.previousSessionIds
}
