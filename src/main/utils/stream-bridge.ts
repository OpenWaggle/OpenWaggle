import type { MessagePart } from '@shared/types/agent'
import type { ActiveRunInfo, BackgroundRunSnapshot, RunMode } from '@shared/types/background-run'
import { type SessionId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentPhaseEventPayload } from '@shared/types/phase'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
import { resetPhaseForSession, updatePhaseFromTransportEvent } from '../agent/phase-tracker'
import { broadcastToWindows } from './broadcast'

// ─── Active Run Tracking ─────────────────────────────────────

interface ActiveStreamBuffer {
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly parts: readonly MessagePart[]
}

const activeBuffers = new Map<SessionId, ActiveStreamBuffer>()

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonObjectOrEmpty(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {}
}

function appendTextPart(parts: readonly MessagePart[], delta: string): readonly MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'text', text: delta }]
}

function appendReasoningPart(parts: readonly MessagePart[], delta: string): readonly MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'reasoning') {
    return [...parts.slice(0, -1), { type: 'reasoning', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'reasoning', text: delta }]
}

function findToolCallPartIndex(parts: readonly MessagePart[], toolCallId: string): number {
  return parts.findIndex(
    (part) => part.type === 'tool-call' && String(part.toolCall.id) === toolCallId,
  )
}

function upsertToolCallPart(input: {
  readonly parts: readonly MessagePart[]
  readonly toolCallId: string
  readonly toolName?: string
  readonly args?: JsonValue
}): readonly MessagePart[] {
  const index = findToolCallPartIndex(input.parts, input.toolCallId)
  const existingPart = index === -1 ? null : input.parts[index]
  const toolName =
    input.toolName || (existingPart?.type === 'tool-call' ? existingPart.toolCall.name : '')
  const toolCallPart: MessagePart = {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(input.toolCallId),
      name: toolName,
      args: jsonObjectOrEmpty(input.args),
      state: 'input-complete',
    },
  }
  if (index === -1) {
    return [...input.parts, toolCallPart]
  }
  return [...input.parts.slice(0, index), toolCallPart, ...input.parts.slice(index + 1)]
}

function appendToolResultPart(input: {
  readonly parts: readonly MessagePart[]
  readonly toolCallId: string
  readonly toolName: string
  readonly args?: JsonValue
  readonly result: JsonValue
  readonly isError: boolean
}): readonly MessagePart[] {
  const withoutPreviousResult = input.parts.filter(
    (part) => part.type !== 'tool-result' || String(part.toolResult.id) !== input.toolCallId,
  )
  return [
    ...withoutPreviousResult,
    {
      type: 'tool-result',
      toolResult: {
        id: ToolCallId(input.toolCallId),
        name: input.toolName,
        args: jsonObjectOrEmpty(input.args),
        result: input.result,
        isError: input.isError,
        duration: 0,
      },
    },
  ]
}

function updateBufferedParts(
  sessionId: SessionId,
  update: (parts: readonly MessagePart[]) => readonly MessagePart[],
): void {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return
  activeBuffers.set(sessionId, {
    ...buffer,
    parts: update(buffer.parts),
  })
}

function applyEventToStreamBuffer(sessionId: SessionId, event: AgentTransportEvent): void {
  if (event.type === 'message_start' && event.role === 'assistant') {
    updateBufferedParts(sessionId, () => [])
    return
  }

  if (event.type === 'message_update') {
    const assistantEvent = event.assistantMessageEvent
    if (assistantEvent.type === 'text_delta') {
      updateBufferedParts(sessionId, (parts) => appendTextPart(parts, assistantEvent.delta))
      return
    }

    if (assistantEvent.type === 'thinking_delta') {
      updateBufferedParts(sessionId, (parts) => appendReasoningPart(parts, assistantEvent.delta))
      return
    }

    if (assistantEvent.type === 'toolcall_start' || assistantEvent.type === 'toolcall_end') {
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: assistantEvent.toolCallId,
          toolName: assistantEvent.toolName,
          args: assistantEvent.input,
        }),
      )
      return
    }

    if (assistantEvent.type === 'toolcall_delta' && assistantEvent.input !== undefined) {
      updateBufferedParts(sessionId, (parts) =>
        upsertToolCallPart({
          parts,
          toolCallId: assistantEvent.toolCallId,
          args: assistantEvent.input,
        }),
      )
    }
    return
  }

  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
    updateBufferedParts(sessionId, (parts) =>
      upsertToolCallPart({
        parts,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }),
    )
    return
  }

  if (event.type === 'tool_execution_end') {
    updateBufferedParts(sessionId, (parts) =>
      appendToolResultPart({
        parts: upsertToolCallPart({
          parts,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        }),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        result: event.result,
        isError: event.isError,
      }),
    )
  }
}

export function startStreamBuffer(
  sessionId: SessionId,
  model: SupportedModelId,
  mode: RunMode,
): void {
  activeBuffers.set(sessionId, {
    model,
    mode,
    startedAt: Date.now(),
    parts: [],
  })
}

export function clearStreamBuffer(sessionId: SessionId): void {
  activeBuffers.delete(sessionId)
}

export function getStreamBuffer(sessionId: SessionId): BackgroundRunSnapshot | null {
  const buffer = activeBuffers.get(sessionId)
  if (!buffer) return null
  return {
    sessionId,
    model: buffer.model,
    mode: buffer.mode,
    startedAt: buffer.startedAt,
    parts: [...buffer.parts],
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

export function emitRunCompleted(sessionId: SessionId): void {
  broadcastToWindows('agent:run-completed', { sessionId })
}

// ─── Transport Event Emission ───────────────────────────────

export function emitTransportEvent(sessionId: SessionId, event: AgentTransportEvent): void {
  applyEventToStreamBuffer(sessionId, event)

  maybeEmitPhase({
    sessionId,
    phase: updatePhaseFromTransportEvent(sessionId, event, Date.now()),
  })

  broadcastToWindows('agent:event', { sessionId, event })
}

export function emitErrorAndFinish(
  sessionId: SessionId,
  message: string,
  code: string,
  runId = '',
): void {
  emitTransportEvent(sessionId, {
    type: 'agent_end',
    runId,
    reason: 'error',
    error: { message, code },
    timestamp: Date.now(),
  })
}

export function emitWaggleTransportEvent(
  sessionId: SessionId,
  event: AgentTransportEvent,
  meta: WaggleStreamMetadata,
): void {
  broadcastToWindows('waggle:event', { sessionId, event, meta })
}

export function emitWaggleTurnEvent(sessionId: SessionId, event: WaggleTurnEvent): void {
  broadcastToWindows('waggle:turn-event', { sessionId, event })
}

export function clearAgentPhase(sessionId: SessionId): void {
  const result = resetPhaseForSession(sessionId)
  if (!result.changed) return
  broadcastToWindows('agent:phase', { sessionId, phase: null })
}

function maybeEmitPhase(input: {
  sessionId: SessionId
  phase: { changed: boolean; phase: AgentPhaseEventPayload['phase'] }
}): void {
  if (!input.phase.changed) return
  broadcastToWindows('agent:phase', {
    sessionId: input.sessionId,
    phase: input.phase.phase,
  })
}
