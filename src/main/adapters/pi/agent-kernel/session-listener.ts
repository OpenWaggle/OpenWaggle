import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { JsonValue } from '@shared/types/json'
import { toJsonValue } from '../pi-message-mapper'
import { getAgentEndError, getAgentEndReason, getAgentEndUsage } from './agent-end-events'
import { handleMessageStart, handleMessageUpdate } from './assistant-events'
import type {
  AgentEndSessionEvent,
  AutoRetryEndSessionEvent,
  AutoRetryStartSessionEvent,
  CompactionEndSessionEvent,
  CompactionStartSessionEvent,
  MessageEndSessionEvent,
  QueueUpdateSessionEvent,
  SessionListenerInput,
  SessionListenerState,
  ToolExecutionEndSessionEvent,
  ToolExecutionStartSessionEvent,
  ToolExecutionUpdateSessionEvent,
} from './listener-types'
import { emitEvent } from './transport-emitter'

function emitAgentStart(state: SessionListenerState) {
  emitEvent(state.input.onEvent, {
    type: 'agent_start',
    runId: state.runId,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleToolExecutionStart(
  state: SessionListenerState,
  event: ToolExecutionStartSessionEvent,
) {
  const toolInput = toJsonValue(event.args)
  state.toolCallInputs.set(event.toolCallId, toolInput)
  emitEvent(state.input.onEvent, {
    type: 'tool_execution_start',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: toolInput,
    parentMessageId: state.currentMessageId ?? undefined,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleToolExecutionUpdate(
  state: SessionListenerState,
  event: ToolExecutionUpdateSessionEvent,
) {
  const toolInput = toJsonValue(event.args)
  state.toolCallInputs.set(event.toolCallId, toolInput)
  emitEvent(state.input.onEvent, {
    type: 'tool_execution_update',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: toolInput,
    partialResult: toJsonValue(event.partialResult),
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleToolExecutionEnd(state: SessionListenerState, event: ToolExecutionEndSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'tool_execution_end',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: state.toolCallInputs.get(event.toolCallId),
    result: toJsonValue(event.result),
    isError: event.isError,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleMessageEnd(state: SessionListenerState, event: MessageEndSessionEvent) {
  if (!state.currentMessageId || event.message.role !== 'assistant') {
    return
  }

  emitEvent(state.input.onEvent, {
    type: 'message_end',
    messageId: state.currentMessageId,
    role: 'assistant',
    timestamp: Date.now(),
    model: state.input.model,
  })
  state.currentMessageId = null
}

function emitQueueUpdate(state: SessionListenerState, event: QueueUpdateSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'queue_update',
    steering: [...event.steering],
    followUp: [...event.followUp],
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitCompactionStart(state: SessionListenerState, event: CompactionStartSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'compaction_start',
    reason: event.reason,
    timestamp: Date.now(),
    model: state.input.model,
  })
}
function emitCompactionEnd(state: SessionListenerState, event: CompactionEndSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'compaction_end',
    reason: event.reason,
    result: toJsonValue(event.result ?? null),
    aborted: event.aborted,
    willRetry: event.willRetry,
    ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitAutoRetryStart(state: SessionListenerState, event: AutoRetryStartSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'auto_retry_start',
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    delayMs: event.delayMs,
    errorMessage: event.errorMessage,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitAutoRetryEnd(state: SessionListenerState, event: AutoRetryEndSessionEvent) {
  emitEvent(state.input.onEvent, {
    type: 'auto_retry_end',
    success: event.success,
    attempt: event.attempt,
    ...(event.finalError ? { finalError: event.finalError } : {}),
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitAgentEnd(state: SessionListenerState, event: AgentEndSessionEvent) {
  const reason = getAgentEndReason(event.messages)
  const error =
    reason === 'error' || reason === 'aborted' ? getAgentEndError(event.messages) : undefined
  emitEvent(state.input.onEvent, {
    type: 'agent_end',
    runId: state.runId,
    reason,
    usage: getAgentEndUsage(event.messages),
    ...(error ? { error } : {}),
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function handleSessionEvent(state: SessionListenerState, event: AgentSessionEvent) {
  matchBy(event, 'type')
    .with('agent_start', () => emitAgentStart(state))
    .with('agent_end', (value) => emitAgentEnd(state, value))
    .with('turn_start', () => undefined)
    .with('turn_end', () => undefined)
    .with('message_start', (value) => handleMessageStart(state, value))
    .with('message_update', (value) => handleMessageUpdate(state, value))
    .with('message_end', (value) => handleMessageEnd(state, value))
    .with('tool_execution_start', (value) => handleToolExecutionStart(state, value))
    .with('tool_execution_update', (value) => handleToolExecutionUpdate(state, value))
    .with('tool_execution_end', (value) => handleToolExecutionEnd(state, value))
    .with('queue_update', (value) => emitQueueUpdate(state, value))
    .with('compaction_start', (value) => emitCompactionStart(state, value))
    .with('compaction_end', (value) => emitCompactionEnd(state, value))
    .with('auto_retry_start', (value) => emitAutoRetryStart(state, value))
    .with('auto_retry_end', (value) => emitAutoRetryEnd(state, value))
    .exhaustive()
}

export function createSessionListener(input: SessionListenerInput, runId: string) {
  const state: SessionListenerState = {
    input,
    runId,
    currentMessageId: null,
    thinkingSteps: new Set<string>(),
    startedToolCalls: new Set<string>(),
    toolCallInputs: new Map<string, JsonValue>(),
  }

  return (event: AgentSessionEvent) => handleSessionEvent(state, event)
}
