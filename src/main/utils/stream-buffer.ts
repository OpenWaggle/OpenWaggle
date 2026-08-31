import { matchBy } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import type {
  ActiveRunInfo,
  BackgroundRunSnapshot,
  RunMode,
  WorktreeLaunchSnapshot,
} from '@shared/types/background-run'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  appendReasoningPart,
  appendTextPart,
  appendToolResultPart,
  upsertToolCallPart,
} from './stream-buffer-message-parts'

interface ActiveStreamBuffer {
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly messageId?: string
  readonly parts: readonly MessagePart[]
  readonly retainedBytes: number
  readonly omittedBytes: number
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
}

const activeBuffers = new Map<SessionId, ActiveStreamBuffer>()
export const MAX_ACTIVE_STREAM_BUFFER_BYTES = 4 * 1024 * 1024
// The Local Session protocol sends all active snapshots in one 8 MiB frame.
// Keep enough headroom for JSON structure, model metadata, and frame fields.
export const MAX_TOTAL_STREAM_BUFFER_BYTES = 6 * 1024 * 1024
let totalRetainedBytes = 0

function retainedEventBytes(event: AgentTransportEvent) {
  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent
    if (update.type === 'text_delta' || update.type === 'thinking_delta') {
      return Buffer.byteLength(update.delta, 'utf8')
    }
    if (
      update.type === 'toolcall_start' ||
      update.type === 'toolcall_delta' ||
      update.type === 'toolcall_end'
    ) {
      return Buffer.byteLength(JSON.stringify(update.input ?? null), 'utf8')
    }
    return 0
  }
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
    return Buffer.byteLength(JSON.stringify(event.args), 'utf8')
  }
  if (event.type === 'tool_execution_end') {
    return Buffer.byteLength(JSON.stringify({ args: event.args, result: event.result }), 'utf8')
  }
  return 0
}

function reserveBufferedBytes(sessionId: SessionId, bytes: number) {
  if (bytes === 0) return true
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return false
  if (
    buffer.retainedBytes + bytes > MAX_ACTIVE_STREAM_BUFFER_BYTES ||
    totalRetainedBytes + bytes > MAX_TOTAL_STREAM_BUFFER_BYTES
  ) {
    activeBuffers.set(sessionId, { ...buffer, omittedBytes: buffer.omittedBytes + bytes })
    return false
  }
  totalRetainedBytes += bytes
  activeBuffers.set(sessionId, { ...buffer, retainedBytes: buffer.retainedBytes + bytes })
  return true
}

function resetBufferedParts(sessionId: SessionId) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  totalRetainedBytes = Math.max(0, totalRetainedBytes - buffer.retainedBytes)
  activeBuffers.set(sessionId, { ...buffer, parts: [], retainedBytes: 0 })
}

function updateBufferedParts(
  sessionId: SessionId,
  update: (parts: readonly MessagePart[]) => readonly MessagePart[],
) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  activeBuffers.set(sessionId, {
    ...buffer,
    parts: update(buffer.parts),
  })
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
      updateBufferedParts(sessionId, (parts) => appendTextPart(parts, assistantEvent.delta))
    })
    .with('thinking_delta', (assistantEvent) => {
      updateBufferedParts(sessionId, (parts) => appendReasoningPart(parts, assistantEvent.delta))
    })
    .with('toolcall_start', 'toolcall_end', (assistantEvent) => {
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
        updateBufferedParts(sessionId, (parts) =>
          upsertToolCallPart({
            parts,
            toolCallId: assistantEvent.toolCallId,
            args: assistantEvent.input,
          }),
        )
      }
    })
    .with('done', 'error', () => undefined)
    .exhaustive()
}

function applyToolExecutionEndToStreamBuffer(
  sessionId: SessionId,
  value: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
) {
  updateBufferedParts(sessionId, (parts) =>
    appendToolResultPart({
      parts: upsertToolCallPart({
        parts,
        toolCallId: value.toolCallId,
        toolName: value.toolName,
        args: value.args,
      }),
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      args: value.args,
      result: value.result,
      isError: value.isError,
    }),
  )
}

export function applyEventToStreamBuffer(sessionId: SessionId, event: AgentTransportEvent) {
  if (!reserveBufferedBytes(sessionId, retainedEventBytes(event))) return
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
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: value.toolCallId,
          toolName: value.toolName,
          args: value.args,
        }),
      )
    })
    .with('tool_execution_end', (value) => applyToolExecutionEndToStreamBuffer(sessionId, value))
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
        },
  )
}

export function clearStreamBuffer(sessionId: SessionId) {
  const buffer = activeBuffers.get(sessionId)
  if (buffer) totalRetainedBytes = Math.max(0, totalRetainedBytes - buffer.retainedBytes)
  activeBuffers.delete(sessionId)
}

export function setWorktreeLaunchSnapshot(
  sessionId: SessionId,
  snapshot: WorktreeLaunchSnapshot | null,
) {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  if (snapshot === null) {
    const { worktreeLaunch: _worktreeLaunch, ...withoutLaunch } = buffer
    activeBuffers.set(sessionId, withoutLaunch)
    return
  }
  activeBuffers.set(sessionId, { ...buffer, worktreeLaunch: snapshot })
}

export function getStreamBuffer(sessionId: SessionId): BackgroundRunSnapshot | null {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return null
  return {
    sessionId,
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    ...(buffer.messageId ? { messageId: buffer.messageId } : {}),
    parts: [...buffer.parts],
    ...(buffer.omittedBytes > 0
      ? { degraded: { reason: 'content-limit' as const, omittedBytes: buffer.omittedBytes } }
      : {}),
    ...(buffer.worktreeLaunch ? { worktreeLaunch: buffer.worktreeLaunch } : {}),
  }
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
  const previousSessionIds = [...activeBuffers.keys()]
  activeBuffers.clear()
  totalRetainedBytes = 0
  for (const snapshot of snapshots) {
    const retainedBytes = Buffer.byteLength(JSON.stringify(snapshot.parts), 'utf8')
    const accepted =
      retainedBytes <= MAX_ACTIVE_STREAM_BUFFER_BYTES &&
      totalRetainedBytes + retainedBytes <= MAX_TOTAL_STREAM_BUFFER_BYTES
    activeBuffers.set(snapshot.sessionId, {
      model: snapshot.model,
      mode: snapshot.mode,
      startedAt: snapshot.startedAt,
      ...(snapshot.messageId ? { messageId: snapshot.messageId } : {}),
      parts: accepted ? [...snapshot.parts] : [],
      retainedBytes: accepted ? retainedBytes : 0,
      omittedBytes: (snapshot.degraded?.omittedBytes ?? 0) + (accepted ? 0 : retainedBytes),
      ...(snapshot.worktreeLaunch ? { worktreeLaunch: snapshot.worktreeLaunch } : {}),
    })
    totalRetainedBytes += accepted ? retainedBytes : 0
  }
  return previousSessionIds
}
