import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { createStreamingMessageId, toJsonValue } from '../pi-message-mapper'
import type {
  MessageStartSessionEvent,
  MessageUpdateSessionEvent,
  PiAssistantToolCall,
  SessionListenerState,
  TextDeltaAssistantEvent,
  ThinkingDeltaAssistantEvent,
  ThinkingStartAssistantEvent,
  ToolCallDeltaAssistantEvent,
  ToolCallEndAssistantEvent,
  ToolCallStartAssistantEvent,
} from './listener-types'
import { emitEvent } from './transport-emitter'

/**
 * A streaming tool call whose input is still this small keeps its preview live: every delta is
 * emitted as Pi re-parses it.
 */
const TOOL_CALL_EAGER_INPUT_CHARS = 8 * 1024
/**
 * Once a tool call's input outgrows that, raw deltas are held until this many characters
 * accumulated, which bounds how often the call's whole input is sent. Every `toolcall_delta`
 * event carries that whole input, so without a bound of OpenWaggle's own the ~11,000 deltas of a
 * 200 KB Bedrock tool call send about 1.2 GB. Pi's own parse rate is not a bound OpenWaggle may
 * rely on: 1.6.0 refreshes the arguments object on every delta for an input this size.
 */
const TOOL_CALL_DELTA_BATCH_CHARS = 8 * 1024

function getToolCallFromAssistantEvent(event: AgentSessionEvent) {
  return matchBy(event, 'type')
    .with('message_update', (value) =>
      matchBy(value.assistantMessageEvent, 'type')
        .with('toolcall_end', (assistantEvent) => ({
          id: assistantEvent.toolCall.id,
          name: assistantEvent.toolCall.name,
          arguments: assistantEvent.toolCall.arguments,
        }))
        .with('toolcall_start', 'toolcall_delta', (assistantEvent) => {
          if (!('partial' in assistantEvent)) {
            return null
          }

          const content = assistantEvent.partial.content[assistantEvent.contentIndex]
          if (content?.type !== 'toolCall') {
            return null
          }

          return {
            id: content.id,
            name: content.name,
            arguments: content.arguments,
          }
        })
        .otherwise(() => null),
    )
    .otherwise(() => null)
}

function emitAssistantMessageStart(state: SessionListenerState, messageId: string) {
  emitEvent(state.input.onEvent, {
    type: 'message_start',
    messageId,
    role: 'assistant',
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function ensureAssistantMessageStarted(state: SessionListenerState) {
  if (!state.currentMessageId) {
    state.currentMessageId = createStreamingMessageId()
    emitAssistantMessageStart(state, state.currentMessageId)
  }
  return state.currentMessageId
}

export function handleMessageStart(state: SessionListenerState, event: MessageStartSessionEvent) {
  if (event.message.role !== 'assistant') {
    return
  }

  state.currentMessageId = createStreamingMessageId()
  emitAssistantMessageStart(state, state.currentMessageId)
}

function emitTextDeltaUpdate(
  state: SessionListenerState,
  messageId: string,
  assistantEvent: TextDeltaAssistantEvent,
) {
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: assistantEvent.contentIndex,
      delta: assistantEvent.delta,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function thinkingStepId(messageId: string, contentIndex: number) {
  return `${messageId}:thinking:${String(contentIndex)}`
}

function emitThinkingStartUpdate(
  state: SessionListenerState,
  messageId: string,
  assistantEvent: ThinkingStartAssistantEvent,
) {
  state.thinkingSteps.add(thinkingStepId(messageId, assistantEvent.contentIndex))
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'thinking_start',
      contentIndex: assistantEvent.contentIndex,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function ensureThinkingStarted(
  state: SessionListenerState,
  messageId: string,
  contentIndex: number,
) {
  const stepId = thinkingStepId(messageId, contentIndex)
  if (state.thinkingSteps.has(stepId)) {
    return
  }

  state.thinkingSteps.add(stepId)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: { type: 'thinking_start', contentIndex },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitThinkingDeltaUpdate(
  state: SessionListenerState,
  messageId: string,
  assistantEvent: ThinkingDeltaAssistantEvent,
) {
  ensureThinkingStarted(state, messageId, assistantEvent.contentIndex)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: assistantEvent.contentIndex,
      delta: assistantEvent.delta,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}
function emitToolCallStart(
  state: SessionListenerState,
  messageId: string,
  contentIndex: number,
  toolCall: PiAssistantToolCall,
) {
  if (state.startedToolCalls.has(toolCall.id)) {
    return
  }

  const toolInput = toJsonValue(toolCall.arguments)
  state.startedToolCalls.add(toolCall.id)
  state.toolCallInputs.set(toolCall.id, toolInput)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolInput,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleToolCallStart(
  state: SessionListenerState,
  messageId: string,
  event: MessageUpdateSessionEvent,
  assistantEvent: ToolCallStartAssistantEvent,
) {
  const toolCall = getToolCallFromAssistantEvent(event)
  if (toolCall) {
    emitToolCallStart(state, messageId, assistantEvent.contentIndex, toolCall)
  }
}

function emitToolCallDeltaUpdate(
  state: SessionListenerState,
  messageId: string,
  event: MessageUpdateSessionEvent,
  assistantEvent: ToolCallDeltaAssistantEvent,
) {
  const toolCall = getToolCallFromAssistantEvent(event)
  if (!toolCall) {
    return
  }

  emitToolCallStart(state, messageId, assistantEvent.contentIndex, toolCall)
  // Pi replaces a streaming tool call's `arguments` object whenever it re-parses the partial
  // JSON. Until it does, the input is unchanged, so hold the raw delta back instead of copying
  // and sending the whole input again for every delta. A call that has outgrown the eager size
  // batches its raw deltas too, since 1.6.0 re-parses on every delta and each event carries the
  // call's whole input.
  const stream = state.toolCallStreams.get(toolCall.id)
  if (stream !== undefined) {
    const argumentsChanged = stream.arguments !== toolCall.arguments
    const refreshIsEager = stream.emittedChars < TOOL_CALL_EAGER_INPUT_CHARS
    const batchIsFull = stream.pendingDelta.length >= TOOL_CALL_DELTA_BATCH_CHARS
    if (!batchIsFull && !(argumentsChanged && refreshIsEager)) {
      stream.pendingDelta += assistantEvent.delta
      return
    }
  }

  const delta = (stream?.pendingDelta ?? '') + assistantEvent.delta
  state.toolCallStreams.set(toolCall.id, {
    arguments: toolCall.arguments,
    pendingDelta: '',
    emittedChars: (stream?.emittedChars ?? 0) + delta.length,
  })
  const toolInput = toJsonValue(toolCall.arguments)
  state.toolCallInputs.set(toolCall.id, toolInput)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: assistantEvent.contentIndex,
      toolCallId: toolCall.id,
      delta,
      input: toolInput,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitToolCallEndUpdate(
  state: SessionListenerState,
  messageId: string,
  event: MessageUpdateSessionEvent,
  assistantEvent: ToolCallEndAssistantEvent,
) {
  const toolCall = getToolCallFromAssistantEvent(event)
  if (!toolCall) {
    return
  }

  emitToolCallStart(state, messageId, assistantEvent.contentIndex, toolCall)
  // The end event carries the exact final input, which supersedes any held-back delta.
  state.toolCallStreams.delete(toolCall.id)
  const toolInput = toJsonValue(toolCall.arguments)
  state.toolCallInputs.set(toolCall.id, toolInput)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'toolcall_end',
      contentIndex: assistantEvent.contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolInput,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

export function handleMessageUpdate(state: SessionListenerState, event: MessageUpdateSessionEvent) {
  const messageId = ensureAssistantMessageStarted(state)
  const assistantEvent = event.assistantMessageEvent

  matchBy(assistantEvent, 'type')
    .with('start', () => undefined)
    .with('text_start', () => undefined)
    .with('text_delta', (value) => emitTextDeltaUpdate(state, messageId, value))
    .with('text_end', () => undefined)
    .with('thinking_start', (value) => emitThinkingStartUpdate(state, messageId, value))
    .with('thinking_delta', (value) => emitThinkingDeltaUpdate(state, messageId, value))
    .with('thinking_end', () => undefined)
    .with('toolcall_start', (value) => handleToolCallStart(state, messageId, event, value))
    .with('toolcall_delta', (value) => emitToolCallDeltaUpdate(state, messageId, event, value))
    .with('toolcall_end', (value) => emitToolCallEndUpdate(state, messageId, event, value))
    .with('done', () => undefined)
    .with('error', () => undefined)
    .exhaustive()
}
