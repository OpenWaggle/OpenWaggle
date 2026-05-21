import { matchBy } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import type { ActiveRunInfo, BackgroundRunSnapshot, RunMode } from '@shared/types/background-run'
import { type SessionId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'

interface ActiveStreamBuffer {
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
  readonly messageId?: string
  readonly parts: readonly MessagePart[]
}

const activeBuffers = new Map<SessionId, ActiveStreamBuffer>()

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonObjectOrEmpty(value: JsonValue | undefined): Readonly<JsonObject> {
  return isJsonObject(value) ? value : {}
}

function appendTextPart(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'text', text: delta }]
}

function appendReasoningPart(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'reasoning') {
    return [...parts.slice(0, -1), { type: 'reasoning', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'reasoning', text: delta }]
}

function findToolCallPartIndex(parts: readonly MessagePart[], toolCallId: string) {
  return parts.findIndex(
    (part) => part.type === 'tool-call' && String(part.toolCall.id) === toolCallId,
  )
}

function upsertToolCallPart(input: {
  readonly parts: readonly MessagePart[]
  readonly toolCallId: string
  readonly toolName?: string
  readonly args?: JsonValue
}): MessagePart[] {
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
}): MessagePart[] {
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
  matchBy(event, 'type')
    .with('agent_start', 'agent_end', 'turn_start', 'turn_end', () => undefined)
    .with('message_start', (value) => {
      if (value.role === 'assistant') {
        updateBufferedAssistantMessageId(sessionId, value.messageId)
        updateBufferedParts(sessionId, () => [])
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
      () => undefined,
    )
    .exhaustive()
}

export function startStreamBuffer(sessionId: SessionId, model: SupportedModelId, mode: RunMode) {
  activeBuffers.set(sessionId, {
    model,
    mode,
    startedAt: Date.now(),
    parts: [],
  })
}

export function clearStreamBuffer(sessionId: SessionId) {
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
    ...(buffer.messageId ? { messageId: buffer.messageId } : {}),
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
