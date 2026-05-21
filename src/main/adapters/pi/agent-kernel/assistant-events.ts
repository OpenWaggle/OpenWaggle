import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
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

function getToolCallFromAssistantEvent(event: AgentSessionEvent): PiAssistantToolCall | null {
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
          if (!content || content.type !== 'toolCall') {
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
      delta: assistantEvent.delta,
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
