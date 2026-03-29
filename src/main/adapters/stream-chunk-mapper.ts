/**
 * Bidirectional mapper between domain AgentStreamChunk and TanStack AI StreamChunk.
 *
 * This is the single translation point between the vendor streaming type
 * and the domain-owned type. Both types are structurally identical — the
 * mapper enforces the type boundary at compile time.
 */
import type { AgentStreamChunk } from '@shared/types/stream'
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
  switch (chunk.type) {
    case 'RUN_STARTED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        threadId: chunk.threadId,
      }
    case 'RUN_FINISHED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        finishReason: chunk.finishReason,
        usage: chunk.usage
          ? {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
            }
          : undefined,
      }
    case 'RUN_ERROR':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        error: {
          message: chunk.error.message,
          code: chunk.error.code,
          ...('name' in chunk.error && typeof chunk.error.name === 'string'
            ? { name: chunk.error.name }
            : {}),
          ...('stack' in chunk.error && typeof chunk.error.stack === 'string'
            ? { stack: chunk.error.stack }
            : {}),
        },
      }
    case 'TEXT_MESSAGE_START':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
        role: chunk.role,
      }
    case 'TEXT_MESSAGE_CONTENT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
        delta: chunk.delta,
        content: chunk.content,
      }
    case 'TEXT_MESSAGE_END':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
      }
    case 'TOOL_CALL_START':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        parentMessageId: chunk.parentMessageId,
        index: chunk.index,
      }
    case 'TOOL_CALL_ARGS':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        delta: chunk.delta,
        args: chunk.args,
      }
    case 'TOOL_CALL_END':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
        result: chunk.result,
      }
    case 'STEP_STARTED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        stepId: chunk.stepId,
        stepType: chunk.stepType,
      }
    case 'STEP_FINISHED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        stepId: chunk.stepId,
        delta: chunk.delta,
        content: chunk.content,
      }
    case 'MESSAGES_SNAPSHOT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messages: chunk.messages,
      }
    case 'STATE_SNAPSHOT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        state: chunk.state,
      }
    case 'STATE_DELTA':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        delta: chunk.delta,
      }
    case 'CUSTOM':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        name: chunk.name,
        value: chunk.value,
      }
  }
}

/**
 * Convert a domain-owned AgentStreamChunk back to a TanStack AI StreamChunk.
 */
export function fromAgentStreamChunk(chunk: AgentStreamChunk): StreamChunk {
  switch (chunk.type) {
    case 'RUN_STARTED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        threadId: chunk.threadId,
      }
    case 'RUN_FINISHED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        finishReason: chunk.finishReason,
        usage: chunk.usage
          ? {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
            }
          : undefined,
      }
    case 'RUN_ERROR':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        runId: chunk.runId,
        error: {
          message: chunk.error.message,
          code: chunk.error.code,
          ...('name' in chunk.error && typeof chunk.error.name === 'string'
            ? { name: chunk.error.name }
            : {}),
          ...('stack' in chunk.error && typeof chunk.error.stack === 'string'
            ? { stack: chunk.error.stack }
            : {}),
        },
      }
    case 'TEXT_MESSAGE_START':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
        role: chunk.role,
      }
    case 'TEXT_MESSAGE_CONTENT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
        delta: chunk.delta,
        content: chunk.content,
      }
    case 'TEXT_MESSAGE_END':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        messageId: chunk.messageId,
      }
    case 'TOOL_CALL_START':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        parentMessageId: chunk.parentMessageId,
        index: chunk.index,
      }
    case 'TOOL_CALL_ARGS':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        delta: chunk.delta,
        args: chunk.args,
      }
    case 'TOOL_CALL_END':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
        result: chunk.result,
      }
    case 'STEP_STARTED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        stepId: chunk.stepId,
        stepType: chunk.stepType,
      }
    case 'STEP_FINISHED':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        stepId: chunk.stepId,
        delta: chunk.delta,
        content: chunk.content,
      }
    case 'MESSAGES_SNAPSHOT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        // MESSAGES_SNAPSHOT messages are UIMessages at runtime, stored as unknown[] in domain.
        // Validated at runtime via structural check — no compile-time cast needed.
        messages: chunk.messages.filter(isUIMessageShape),
      }
    case 'STATE_SNAPSHOT':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        state: chunk.state,
      }
    case 'STATE_DELTA':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        delta: chunk.delta,
      }
    case 'CUSTOM':
      return {
        type: chunk.type,
        timestamp: chunk.timestamp,
        model: chunk.model,
        rawEvent: chunk.rawEvent,
        name: chunk.name,
        value: chunk.value,
      }
  }
}
