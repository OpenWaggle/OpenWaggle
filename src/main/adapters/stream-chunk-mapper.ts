/**
 * Bidirectional mapper between domain AgentStreamChunk and TanStack AI StreamChunk.
 *
 * This is the single translation point between the vendor streaming type
 * and the domain-owned type. Both types are structurally identical — the
 * mapper enforces the type boundary at compile time.
 */
import type { AgentStreamChunk } from '@shared/types/stream'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk, UIMessage } from '@tanstack/ai'

/**
 * Runtime type guard validating that an unknown value has the UIMessage shape.
 * Used at the adapter boundary for MESSAGES_SNAPSHOT events where domain stores
 * messages as unknown[] but vendor requires UIMessage[].
 */
function isUIMessageShape(value: unknown): value is UIMessage {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('role' in value) || typeof value.role !== 'string') return false
  if (!('parts' in value) || !Array.isArray(value.parts)) return false
  return true
}

/**
 * Convert a TanStack AI StreamChunk to a domain-owned AgentStreamChunk.
 */
export function toAgentStreamChunk(chunk: StreamChunk): AgentStreamChunk {
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
      error: {
        message: c.error.message,
        code: c.error.code,
        ...('name' in c.error && typeof c.error.name === 'string' ? { name: c.error.name } : {}),
        ...('stack' in c.error && typeof c.error.stack === 'string'
          ? { stack: c.error.stack }
          : {}),
      },
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
      messages: c.messages,
    }))
    .case('STATE_SNAPSHOT', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      state: c.state,
    }))
    .case('STATE_DELTA', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      delta: c.delta,
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

/**
 * Convert a domain-owned AgentStreamChunk back to a TanStack AI StreamChunk.
 */
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
      error: {
        message: c.error.message,
        code: c.error.code,
        ...('name' in c.error && typeof c.error.name === 'string' ? { name: c.error.name } : {}),
        ...('stack' in c.error && typeof c.error.stack === 'string'
          ? { stack: c.error.stack }
          : {}),
      },
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
      // MESSAGES_SNAPSHOT messages are UIMessages at runtime, stored as unknown[] in domain.
      // Validated at runtime via structural check — no compile-time cast needed.
      messages: c.messages.filter(isUIMessageShape),
    }))
    .case('STATE_SNAPSHOT', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      state: c.state,
    }))
    .case('STATE_DELTA', (c) => ({
      type: c.type,
      timestamp: c.timestamp,
      model: c.model,
      rawEvent: c.rawEvent,
      delta: c.delta,
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
