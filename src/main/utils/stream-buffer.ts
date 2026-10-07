import { matchBy } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import type {
  ActiveRunInfo,
  BackgroundRunActivityEvent,
  BackgroundRunSnapshot,
  RunMode,
  WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  continuedRunContent,
  retainFinishedAssistantMessage,
  runHistoryBytes,
} from './stream-buffer-history'
import { upsertToolCallPart } from './stream-buffer-message-parts'
import { restoreStreamBufferSnapshots } from './stream-buffer-restore'
import {
  type ActiveStreamBuffer,
  emptyActiveStreamBuffer,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  MAX_DEGRADED_TOOL_CALL_IDS,
  MAX_TOTAL_STREAM_BUFFER_BYTES,
  retainedStreamBufferBytes,
  startsAnotherRun,
  toStreamBufferSnapshot,
  withoutRetainedStreamContent,
  withWorktreeLaunchSnapshot,
} from './stream-buffer-snapshots'
import { applyToolExecutionEndToParts } from './stream-buffer-tool-parts'
import {
  appendStreamBufferText,
  appendStreamBufferToolCallDelta,
  appendStreamBufferUserMessage,
  type StreamBufferUpdate,
  updateStreamBufferActivityEvents,
  updateStreamBufferParts,
} from './stream-buffer-updates'

export { MAX_ACTIVE_STREAM_BUFFER_BYTES, MAX_DEGRADED_TOOL_CALL_IDS, MAX_TOTAL_STREAM_BUFFER_BYTES }

const activeBuffers = new Map<SessionId, ActiveStreamBuffer>()
// The Local Session protocol sends all active snapshots in one 8 MiB frame.
// Keep enough headroom for JSON structure, model metadata, and frame fields.
let totalRetainedBytes = 0
// The Runs' finished-message history, under its own budget (`stream-buffer-history`).
let totalHistoryBytes = 0

/** The next assistant message starts: the finished one joins the history, its parts released. */
function startBufferedAssistantMessage(sessionId: SessionId, messageId: string, startedAt: number) {
  const finished = activeBuffers.get(sessionId)
  if (!finished) return
  const retained = retainFinishedAssistantMessage(finished, totalHistoryBytes)
  totalHistoryBytes += retained.historyDelta
  const buffer = retained.buffer
  totalRetainedBytes = Math.max(
    0,
    totalRetainedBytes - buffer.retainedBytes - buffer.degradedToolCallIdsBytes,
  )
  activeBuffers.set(sessionId, { ...withoutRetainedStreamContent(buffer, startedAt), messageId })
}

function applyBufferedUpdate(
  sessionId: SessionId,
  update: (buffer: ActiveStreamBuffer) => StreamBufferUpdate,
) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  const result = update(buffer)
  totalRetainedBytes += result.retainedDelta
  activeBuffers.set(sessionId, result.buffer)
}

function updateBufferedParts(
  sessionId: SessionId,
  update: (parts: readonly MessagePart[]) => readonly MessagePart[],
  attemptedContentBytes?: number,
) {
  applyBufferedUpdate(sessionId, (buffer) =>
    updateStreamBufferParts(buffer, update, totalRetainedBytes, attemptedContentBytes),
  )
}

function appendBufferedToolCallDelta(
  sessionId: SessionId,
  input: { readonly toolCallId: string; readonly delta: string; readonly args: JsonValue },
) {
  applyBufferedUpdate(sessionId, (buffer) =>
    appendStreamBufferToolCallDelta(buffer, input, totalRetainedBytes),
  )
}

function appendBufferedText(sessionId: SessionId, type: 'text' | 'reasoning', delta: string) {
  applyBufferedUpdate(sessionId, (buffer) =>
    appendStreamBufferText(buffer, type, delta, totalRetainedBytes),
  )
}

function updateBufferedAssistantMessageId(sessionId: SessionId, messageId: string) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  activeBuffers.set(sessionId, {
    ...buffer,
    messageId,
  })
}

function updateBufferedActivityEvents(
  sessionId: SessionId,
  update: (events: readonly BackgroundRunActivityEvent[]) => readonly BackgroundRunActivityEvent[],
) {
  applyBufferedUpdate(sessionId, (buffer) =>
    updateStreamBufferActivityEvents(buffer, update, totalRetainedBytes),
  )
}

function upsertBufferedToolCall(
  sessionId: SessionId,
  toolCall: Omit<Parameters<typeof upsertToolCallPart>[0], 'parts'>,
) {
  updateBufferedParts(sessionId, (parts) => upsertToolCallPart({ parts, ...toolCall }))
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
    .with('toolcall_start', ({ toolCallId, toolName, input }) => {
      upsertBufferedToolCall(sessionId, { toolCallId, toolName, args: input })
    })
    .with('toolcall_end', ({ toolCallId, toolName, input }) => {
      if (activeBuffers.get(sessionId)?.degradedToolCallIds.has(toolCallId)) return
      upsertBufferedToolCall(sessionId, { toolCallId, toolName, args: input })
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
        startBufferedAssistantMessage(sessionId, value.messageId, value.timestamp)
      }
      if (value.role === 'user') {
        applyBufferedUpdate(sessionId, (buffer) =>
          appendStreamBufferUserMessage(buffer, value, totalRetainedBytes),
        )
      }
    })
    .with('message_update', (value) => applyMessageUpdateToStreamBuffer(sessionId, value))
    .with('message_end', 'context_usage', () => undefined)
    .with('tool_execution_start', 'tool_execution_update', ({ toolCallId, toolName, args }) => {
      if (activeBuffers.get(sessionId)?.degradedToolCallIds.has(toolCallId)) return
      upsertBufferedToolCall(sessionId, { toolCallId, toolName, args })
    })
    .with('tool_execution_end', (value) => {
      const preserveArgs = activeBuffers.get(sessionId)?.degradedToolCallIds.has(value.toolCallId)
      updateBufferedParts(sessionId, (parts) =>
        applyToolExecutionEndToParts(parts, value, preserveArgs),
      )
    })
    .with('compaction_start', (value) => {
      updateBufferedActivityEvents(sessionId, (events) => [
        ...events.filter(
          (event) => event.type === 'compaction_start' || event.type === 'compaction_end',
        ),
        value,
      ])
    })
    .with('compaction_end', (value) => {
      updateBufferedActivityEvents(sessionId, (events) => [...events, value])
    })
    .with('auto_retry_start', (value) => {
      updateBufferedActivityEvents(sessionId, (events) => [...events, value])
    })
    .with('auto_retry_end', () => {
      updateBufferedActivityEvents(sessionId, (events) =>
        events.filter(
          (event) => event.type === 'compaction_start' || event.type === 'compaction_end',
        ),
      )
    })
    .with(
      'queue_update',
      'custom',
      'agent_interaction_request',
      'agent_interaction_resolved',
      () => undefined,
    )
    .exhaustive()
}

export function startStreamBuffer(
  sessionId: SessionId,
  model: SupportedModelId,
  mode: RunMode,
  runId?: string,
) {
  const continued = continuedRunContent(activeBuffers.get(sessionId), runId, totalHistoryBytes)
  clearStreamBuffer(sessionId)
  activeBuffers.set(sessionId, {
    ...emptyActiveStreamBuffer({ model, mode, startedAt: Date.now(), runId }),
    activityEvents: [],
    ...continued,
  })
  totalRetainedBytes += continued.userMessagesBytes ?? 0
  totalHistoryBytes += runHistoryBytes(continued)
}

export function upsertStreamBufferRunIdentity(
  sessionId: SessionId,
  model: SupportedModelId,
  mode: RunMode,
) {
  const existing = activeBuffers.get(sessionId)
  if (!existing) {
    startStreamBuffer(sessionId, model, mode)
    return
  }
  activeBuffers.set(sessionId, { ...existing, model, mode })
}

export function startStreamBufferFromAgentStart(
  sessionId: SessionId,
  event: Extract<AgentTransportEvent, { type: 'agent_start' }>,
) {
  const previous = activeBuffers.get(sessionId)
  if (previous && startsAnotherRun(previous, event.runId)) clearStreamBuffer(sessionId)
  const existing = activeBuffers.get(sessionId)
  const fallbackModel = existing?.model ?? previous?.model ?? SupportedModelId('')
  const model = event.model ? SupportedModelId(event.model) : fallbackModel
  const mode = existing?.mode ?? (event.runId.startsWith('waggle-') ? 'waggle' : 'classic')
  activeBuffers.set(
    sessionId,
    existing
      ? { ...existing, runId: event.runId, model, mode }
      : emptyActiveStreamBuffer({ model, mode, startedAt: event.timestamp, runId: event.runId }),
  )
}

export function clearStreamBuffer(sessionId: SessionId) {
  const buffer = activeBuffers.get(sessionId)
  if (buffer) {
    totalRetainedBytes = Math.max(0, totalRetainedBytes - retainedStreamBufferBytes(buffer))
    totalHistoryBytes = Math.max(0, totalHistoryBytes - runHistoryBytes(buffer))
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
      activity: 'agent-run',
      sessionId,
      model: buffer.model,
      mode: buffer.mode,
      startedAt: buffer.startedAt,
      activityEvents: [...(buffer.activityEvents ?? [])],
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

/** Replaces the buffers with the snapshots; returns the Run each replaced buffer held, by Session. */
export function replaceStreamBufferSnapshots(
  snapshots: readonly BackgroundRunSnapshot[],
): ReadonlyMap<SessionId, string | undefined> {
  const restored = restoreStreamBufferSnapshots(activeBuffers, snapshots)
  totalRetainedBytes = restored.totalRetainedBytes
  totalHistoryBytes = restored.totalHistoryBytes
  return restored.previousRunIds
}
