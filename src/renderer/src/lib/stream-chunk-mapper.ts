/**
 * Renderer-side mapper from domain AgentStreamChunk to TanStack AI StreamChunk.
 *
 * The IPC contract delivers AgentStreamChunk (domain-owned).
 * TanStack AI's useChat/applyStreamDelta expect StreamChunk (vendor).
 * This mapper constructs vendor objects from domain fields — no type casts.
 */
import type { AgentStreamChunk } from '@shared/types/stream'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk, UIMessage } from '@tanstack/ai'

/** Runtime validation that an unknown value has the UIMessage shape. */
function isUIMessageShape(value: unknown): value is UIMessage {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('role' in value) || typeof value.role !== 'string') return false
  if (!('parts' in value) || !Array.isArray(value.parts)) return false
  return true
}

export function fromAgentStreamChunk(chunk: AgentStreamChunk): StreamChunk {
  return chooseBy(chunk, 'type')
    .case('RUN_STARTED', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      runId: c.runId,
      threadId: c.threadId,
    }))
    .case('RUN_FINISHED', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      runId: c.runId,
      finishReason: c.finishReason,
      usage: c.usage
        ? {
            promptTokens: c.usage.promptTokens,
            completionTokens: c.usage.completionTokens,
            totalTokens: c.usage.totalTokens,
          }
        : undefined,
    }))
    .case('RUN_ERROR', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      runId: c.runId,
      error: { message: c.error.message, code: c.error.code },
    }))
    .case('TEXT_MESSAGE_START', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      messageId: c.messageId,
      role: c.role,
    }))
    .case('TEXT_MESSAGE_CONTENT', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      messageId: c.messageId,
      delta: c.delta,
      content: c.content,
    }))
    .case('TEXT_MESSAGE_END', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      messageId: c.messageId,
    }))
    .case('TOOL_CALL_START', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      parentMessageId: c.parentMessageId,
      index: c.index,
    }))
    .case('TOOL_CALL_ARGS', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      toolCallId: c.toolCallId,
      delta: c.delta,
      args: c.args,
    }))
    .case('TOOL_CALL_END', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input,
      result: c.result,
    }))
    .case('STEP_STARTED', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      stepId: c.stepId,
      stepType: c.stepType,
    }))
    .case('STEP_FINISHED', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      stepId: c.stepId,
      delta: c.delta,
      content: c.content,
    }))
    .case('MESSAGES_SNAPSHOT', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      messages: c.messages.filter(isUIMessageShape),
    }))
    .case('STATE_SNAPSHOT', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      state: { ...c.state },
    }))
    .case('STATE_DELTA', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      delta: { ...c.delta },
    }))
    .case('CUSTOM', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      name: c.name,
      value: c.value,
    }))
    .assertComplete()
}
