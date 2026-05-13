import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { match, matchBy, P } from '@diegogbrisa/ts-match'
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionServices,
  ContextUsage,
  CreateAgentSessionRuntimeFactory,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  SessionEntry,
} from '@mariozechner/pi-coding-agent'
import { createAgentSessionRuntime, SessionManager } from '@mariozechner/pi-coding-agent'
import {
  getMessageText,
  type HydratedAgentSendPayload,
  isToolCallPart,
  type Message,
  type MessagePart,
  type MessageRole,
} from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { ContextUsageSnapshot } from '@shared/types/context-usage'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { createModelRef, type SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { AgentTransportAgentEndEvent, AgentTransportEvent } from '@shared/types/stream'
import { clampThinkingLevel } from '@shared/utils/thinking-levels'
import { isRecord } from '@shared/utils/validation'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import {
  type AgentKernelCompactResult,
  type AgentKernelForkSessionResult,
  AgentKernelMissingEntryError,
  type AgentKernelRunInput,
  type AgentKernelRunResult,
  AgentKernelService,
  type AgentKernelSessionInput,
  type AgentKernelSessionSnapshot,
  type AgentKernelWaggleRunInput,
  type AgentKernelWaggleTurnCompletion,
  type CompactAgentKernelSessionInput,
  type ForkAgentKernelSessionInput,
  type NavigateAgentKernelSessionInput,
} from '../../ports/agent-kernel-service'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createStreamingMessageId, toJsonObject, toJsonValue } from './pi-message-mapper'
import {
  createPiProjectModelRuntime,
  getPiAgentDir,
  getPiModelAvailableThinkingLevels,
  type PiModel,
} from './pi-provider-catalog'
import {
  buildPiRunAssistantMessages,
  buildPiRunNewMessages,
  extractPiAssistantTerminalError,
  getPiAssistantStopReason,
} from './pi-run-result'
import { buildPiPromptInput, type PiPromptInput } from './pi-runtime-input'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
  withOpenWagglePiSessionLifecycleContext,
} from './pi-session-lifecycle'

const logger = createLogger('pi-agent-kernel')
const WAGGLE_VISIBLE_USER_CUSTOM_TYPE = 'openwaggle.waggle.user_request'
const WAGGLE_TURN_CUSTOM_TYPE = 'openwaggle.waggle.turn'

type PiCustomTextContent = {
  readonly type: 'text'
  readonly text: string
}

type PiCustomContent = string | (PiCustomTextContent | PiPromptInput['images'][number])[]

interface PiRunSessionRuntime {
  readonly model: PiModel
  readonly session: AgentSession
}

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

function createDeferred(): Deferred {
  let resolveCurrent: (() => void) | undefined
  let rejectCurrent: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolveCurrent = resolve
    rejectCurrent = reject
  })

  return {
    promise,
    resolve: () => resolveCurrent?.(),
    reject: (error) => rejectCurrent?.(error),
  }
}

function resolveProjectPath(input: AgentKernelRunInput): string {
  return resolveSessionProjectPath(input.session)
}

function resolveSessionProjectPath(session: SessionDetail): string {
  const projectPath = session.projectPath
  if (!projectPath) {
    throw new Error('No project path set on the session — cannot run Pi agent')
  }
  return projectPath
}

function parsePiEntryTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function textMessagePart(text: string): MessagePart {
  return { type: 'text', text }
}

function emptyTextMessagePart(): MessagePart {
  return textMessagePart('')
}

function imageInputMessagePart(mimeType: string): MessagePart {
  return textMessagePart(`[Image input: ${mimeType}]`)
}

function piTextOrImageBlockToPart(block: unknown): MessagePart | null {
  return match(block)
    .with({ type: 'text', text: P.select('text', P.string) }, ({ text }) => textMessagePart(text))
    .with({ type: 'image', mimeType: P.select('mimeType', P.optional(P.string)) }, ({ mimeType }) =>
      imageInputMessagePart(mimeType ?? 'image'),
    )
    .with({ type: 'image' }, () => imageInputMessagePart('image'))
    .otherwise(() => null)
}

function nonEmptyMessageParts(parts: readonly MessagePart[]): MessagePart[] {
  return parts.length > 0 ? [...parts] : [emptyTextMessagePart()]
}

function piTextAndImageContentToParts(content: unknown): MessagePart[] {
  if (typeof content === 'string') {
    return [textMessagePart(content)]
  }

  if (!Array.isArray(content)) {
    return [emptyTextMessagePart()]
  }

  const parts: MessagePart[] = []
  for (const block of content) {
    const part = piTextOrImageBlockToPart(block)
    if (part) {
      parts.push(part)
    }
  }

  return nonEmptyMessageParts(parts)
}

function piAssistantContentToParts(content: readonly unknown[]): MessagePart[] {
  const parts: MessagePart[] = []

  for (const block of content) {
    const part = match(block)
      .with(
        { type: 'text', text: P.select('text', P.string) },
        ({ text }): MessagePart => ({
          type: 'text',
          text,
        }),
      )
      .with(
        { type: 'thinking', thinking: P.select('thinking', P.string) },
        ({ thinking }): MessagePart => ({ type: 'reasoning', text: thinking }),
      )
      .with(
        {
          type: 'toolCall',
          id: P.select('id', P.string),
          name: P.select('name', P.string),
          arguments: P.select('toolArguments', P.optional(P._)),
        },
        ({ id, name, toolArguments }): MessagePart => ({
          type: 'tool-call',
          toolCall: {
            id: ToolCallId(id),
            name,
            args: toJsonObject(toolArguments),
            state: 'input-complete',
          },
        }),
      )
      .otherwise(() => null)

    if (part) {
      parts.push(part)
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

function getToolResultDuration(details: unknown): number {
  if (!isRecord(details) || typeof details.duration !== 'number') {
    return 0
  }
  return details.duration
}

function getToolResultArgs(details: unknown): JsonObject {
  if (!isRecord(details)) {
    return {}
  }
  return toJsonObject(details.args)
}

function isAgentEndReason(
  value: unknown,
): value is 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' {
  return (
    value === 'stop' ||
    value === 'length' ||
    value === 'toolUse' ||
    value === 'error' ||
    value === 'aborted'
  )
}

interface AgentEndAssistantMessage {
  readonly role: 'assistant'
  readonly stopReason?: unknown
  readonly usage?: unknown
  readonly errorMessage?: unknown
}

function isAgentEndAssistantMessage(message: unknown): message is AgentEndAssistantMessage {
  return isRecord(message) && message.role === 'assistant'
}

function getAgentEndAssistantMessage(
  messages: readonly unknown[],
): AgentEndAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isAgentEndAssistantMessage(message)) {
      return message
    }
  }
  return null
}

function getAgentEndReason(
  messages: readonly unknown[],
): 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | null {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  if (!assistantMessage) {
    return null
  }
  return isAgentEndReason(assistantMessage.stopReason) ? assistantMessage.stopReason : null
}

function getAgentEndUsage(
  messages: readonly unknown[],
): AgentTransportAgentEndEvent['usage'] | undefined {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  const usage = assistantMessage?.usage
  if (!isRecord(usage)) {
    return undefined
  }

  const input = typeof usage.input === 'number' ? usage.input : null
  const output = typeof usage.output === 'number' ? usage.output : null
  const totalTokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : null
  if (input === null || output === null || totalTokens === null) {
    return undefined
  }

  return {
    promptTokens: input,
    completionTokens: output,
    totalTokens,
  }
}

function getAgentEndError(messages: readonly unknown[]): { readonly message: string } | undefined {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  if (typeof assistantMessage?.errorMessage !== 'string') {
    return undefined
  }
  return { message: assistantMessage.errorMessage }
}

function piToolResultContentToPart(message: {
  readonly toolCallId: string
  readonly toolName: string
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly details?: unknown
}): MessagePart {
  const details = toJsonValue(message.details ?? null)
  return {
    type: 'tool-result',
    toolResult: {
      id: ToolCallId(message.toolCallId),
      name: message.toolName,
      args: getToolResultArgs(message.details),
      result: {
        content: toJsonValue(message.content),
        details,
      },
      isError: message.isError,
      duration: getToolResultDuration(message.details),
      details,
    },
  }
}

function buildMessageNodeContentJson(parts: readonly MessagePart[], model: string | null): string {
  return JSON.stringify({
    parts: [...parts],
    model,
  })
}

function buildRawNodeContentJson(value: JsonValue): string {
  return JSON.stringify(value)
}

function messageProjectionForEntry(entry: Extract<SessionEntry, { type: 'message' }>): {
  readonly kind: ProjectedSessionNodeInput['kind']
  readonly role: MessageRole | null
  readonly contentJson: string
  readonly metadataJson: string
} {
  const message = entry.message

  return matchBy(message, 'role')
    .with('user', (value) => {
      const parts = piTextAndImageContentToParts(value.content)
      return {
        kind: 'user_message',
        role: 'user',
        contentJson: buildMessageNodeContentJson(parts, null),
        metadataJson: '{}',
      }
    })
    .with('assistant', (value) => {
      const parts = piAssistantContentToParts(value.content)
      const model = createModelRef(value.provider, value.model)
      return {
        kind: 'assistant_message',
        role: 'assistant',
        contentJson: buildMessageNodeContentJson(parts, model),
        metadataJson: buildRawNodeContentJson({
          api: value.api,
          provider: value.provider,
          model: value.model,
          usage: toJsonValue(value.usage),
          stopReason: value.stopReason,
          errorMessage: value.errorMessage ?? null,
        }),
      }
    })
    .with('toolResult', (value) => ({
      kind: 'tool_result',
      role: null,
      contentJson: buildMessageNodeContentJson([piToolResultContentToPart(value)], null),
      metadataJson: buildRawNodeContentJson({
        toolCallId: value.toolCallId,
        toolName: value.toolName,
        isError: value.isError,
      }),
    }))
    .with('branchSummary', (value) => ({
      kind: 'branch_summary',
      role: null,
      contentJson: buildRawNodeContentJson({
        summary: value.summary,
        fromId: value.fromId,
      }),
      metadataJson: '{}',
    }))
    .with('compactionSummary', (value) => ({
      kind: 'compaction_summary',
      role: null,
      contentJson: buildRawNodeContentJson({
        summary: value.summary,
        tokensBefore: value.tokensBefore,
      }),
      metadataJson: '{}',
    }))
    .with('bashExecution', (value) => ({
      kind: 'custom',
      role: null,
      contentJson: buildRawNodeContentJson({
        role: value.role,
        command: value.command,
        output: value.output,
        exitCode: value.exitCode ?? null,
        cancelled: value.cancelled,
        truncated: value.truncated,
        fullOutputPath: value.fullOutputPath ?? null,
        excludeFromContext: value.excludeFromContext ?? false,
      }),
      metadataJson: '{}',
    }))
    .with('custom', (value) => ({
      kind: 'custom',
      role: null,
      contentJson: buildRawNodeContentJson({
        role: value.role,
        customType: value.customType,
        content: toJsonValue(value.content),
        display: value.display,
        details: toJsonValue(value.details ?? null),
      }),
      metadataJson: '{}',
    }))
    .exhaustive()
}

interface PiEntryProjection {
  readonly kind: ProjectedSessionNodeInput['kind']
  readonly role: MessageRole | null
  readonly contentJson: string
  readonly metadataJson: string
}

function modelChangeProjection(
  entry: Extract<SessionEntry, { type: 'model_change' }>,
): PiEntryProjection {
  return {
    kind: 'model_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      provider: entry.provider,
      modelId: entry.modelId,
      modelRef: createModelRef(entry.provider, entry.modelId),
    }),
    metadataJson: '{}',
  }
}

function thinkingLevelChangeProjection(
  entry: Extract<SessionEntry, { type: 'thinking_level_change' }>,
): PiEntryProjection {
  return {
    kind: 'thinking_level_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      thinkingLevel: entry.thinkingLevel,
    }),
    metadataJson: '{}',
  }
}

function compactionEntryProjection(
  entry: Extract<SessionEntry, { type: 'compaction' }>,
): PiEntryProjection {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
      details: toJsonValue(entry.details ?? null),
      fromHook: entry.fromHook ?? false,
    }),
    metadataJson: '{}',
  }
}

function branchSummaryEntryProjection(
  entry: Extract<SessionEntry, { type: 'branch_summary' }>,
): PiEntryProjection {
  return {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      fromId: entry.fromId,
      details: toJsonValue(entry.details ?? null),
      fromHook: entry.fromHook ?? false,
    }),
    metadataJson: '{}',
  }
}

function customEntryProjection(
  entry: Extract<SessionEntry, { type: 'custom' }>,
): PiEntryProjection {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      data: toJsonValue(entry.data ?? null),
    }),
    metadataJson: '{}',
  }
}

function visibleWaggleUserMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(piTextAndImageContentToParts(entry.content), null),
    metadataJson: buildRawNodeContentJson({
      customType: entry.customType,
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
  }
}

function hiddenOrCustomMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      content: toJsonValue(entry.content),
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
    metadataJson: buildRawNodeContentJson({
      customType: entry.customType,
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
  }
}

function customMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  if (entry.customType === WAGGLE_VISIBLE_USER_CUSTOM_TYPE && entry.display) {
    return visibleWaggleUserMessageProjection(entry)
  }

  return hiddenOrCustomMessageProjection(entry)
}

function labelEntryProjection(entry: Extract<SessionEntry, { type: 'label' }>): PiEntryProjection {
  return {
    kind: 'label',
    role: null,
    contentJson: buildRawNodeContentJson({
      targetId: entry.targetId,
      label: entry.label ?? null,
    }),
    metadataJson: '{}',
  }
}

function sessionInfoEntryProjection(
  entry: Extract<SessionEntry, { type: 'session_info' }>,
): PiEntryProjection {
  return {
    kind: 'session_info',
    role: null,
    contentJson: buildRawNodeContentJson({
      name: entry.name ?? null,
    }),
    metadataJson: '{}',
  }
}

function projectionForPiEntry(entry: SessionEntry): PiEntryProjection {
  return matchBy(entry, 'type')
    .with('message', messageProjectionForEntry)
    .with('model_change', modelChangeProjection)
    .with('thinking_level_change', thinkingLevelChangeProjection)
    .with('compaction', compactionEntryProjection)
    .with('branch_summary', branchSummaryEntryProjection)
    .with('custom', customEntryProjection)
    .with('custom_message', customMessageProjection)
    .with('label', labelEntryProjection)
    .with('session_info', sessionInfoEntryProjection)
    .exhaustive()
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)
  const projection = projectionForPiEntry(input.entry)

  return {
    id: input.entry.id,
    parentId: input.entry.parentId,
    piEntryType: input.entry.type,
    kind: projection.kind,
    role: projection.role,
    timestampMs,
    contentJson: projection.contentJson,
    metadataJson: projection.metadataJson,
    pathDepth: input.pathDepth,
    createdOrder: input.createdOrder,
  }
}

function getPiEntryDepth(input: {
  readonly entryId: string
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly depthById: Map<string, number>
}): number {
  const cached = input.depthById.get(input.entryId)
  if (cached !== undefined) {
    return cached
  }

  const entry = input.entryById.get(input.entryId)
  if (!entry?.parentId) {
    input.depthById.set(input.entryId, 0)
    return 0
  }

  const depth =
    getPiEntryDepth({
      entryId: entry.parentId,
      entryById: input.entryById,
      depthById: input.depthById,
    }) + 1
  input.depthById.set(input.entryId, depth)
  return depth
}

function projectPiSessionSnapshot(session: AgentSession): AgentKernelSessionSnapshot {
  const entries = session.sessionManager.getEntries()
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const depthById = new Map<string, number>()

  return {
    activeNodeId: session.sessionManager.getLeafId(),
    nodes: entries.map((entry, index) =>
      projectPiEntry({
        entry,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
      }),
    ),
  }
}

function getToolCallFromAssistantEvent(event: AgentSessionEvent): {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
} | null {
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

function emitEvent(
  onEvent: (event: AgentTransportEvent) => void,
  event: AgentTransportEvent,
): void {
  onEvent(event)
}

interface SessionListenerInput {
  readonly model: SupportedModelId
  readonly onEvent: (event: AgentTransportEvent) => void
}

interface SessionListenerState {
  readonly input: SessionListenerInput
  readonly runId: string
  currentMessageId: string | null
  readonly thinkingSteps: Set<string>
  readonly startedToolCalls: Set<string>
  readonly toolCallInputs: Map<string, JsonValue>
}

type MessageStartSessionEvent = Extract<AgentSessionEvent, { type: 'message_start' }>
type MessageUpdateSessionEvent = Extract<AgentSessionEvent, { type: 'message_update' }>
type MessageEndSessionEvent = Extract<AgentSessionEvent, { type: 'message_end' }>
type QueueUpdateSessionEvent = Extract<AgentSessionEvent, { type: 'queue_update' }>
type CompactionStartSessionEvent = Extract<AgentSessionEvent, { type: 'compaction_start' }>
type CompactionEndSessionEvent = Extract<AgentSessionEvent, { type: 'compaction_end' }>
type AutoRetryStartSessionEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>
type AutoRetryEndSessionEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>
type AgentEndSessionEvent = Extract<AgentSessionEvent, { type: 'agent_end' }>
type ToolExecutionStartSessionEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }>
type ToolExecutionUpdateSessionEvent = Extract<AgentSessionEvent, { type: 'tool_execution_update' }>
type ToolExecutionEndSessionEvent = Extract<AgentSessionEvent, { type: 'tool_execution_end' }>
type AssistantMessageEvent = MessageUpdateSessionEvent['assistantMessageEvent']
type TextDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'text_delta' }>
type ThinkingStartAssistantEvent = Extract<AssistantMessageEvent, { type: 'thinking_start' }>
type ThinkingDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'thinking_delta' }>
type ToolCallStartAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_start' }>
type ToolCallDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_delta' }>
type ToolCallEndAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_end' }>
type PiAssistantToolCall = NonNullable<ReturnType<typeof getToolCallFromAssistantEvent>>

function emitAgentStart(state: SessionListenerState): void {
  emitEvent(state.input.onEvent, {
    type: 'agent_start',
    runId: state.runId,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitAssistantMessageStart(state: SessionListenerState, messageId: string): void {
  emitEvent(state.input.onEvent, {
    type: 'message_start',
    messageId,
    role: 'assistant',
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function ensureAssistantMessageStarted(state: SessionListenerState): string {
  if (!state.currentMessageId) {
    state.currentMessageId = createStreamingMessageId()
    emitAssistantMessageStart(state, state.currentMessageId)
  }
  return state.currentMessageId
}

function handleMessageStart(state: SessionListenerState, event: MessageStartSessionEvent): void {
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
): void {
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

function thinkingStepId(messageId: string, contentIndex: number): string {
  return `${messageId}:thinking:${String(contentIndex)}`
}

function emitThinkingStartUpdate(
  state: SessionListenerState,
  messageId: string,
  assistantEvent: ThinkingStartAssistantEvent,
): void {
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
): void {
  const stepId = thinkingStepId(messageId, contentIndex)
  if (state.thinkingSteps.has(stepId)) {
    return
  }

  state.thinkingSteps.add(stepId)
  emitEvent(state.input.onEvent, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'thinking_start',
      contentIndex,
    },
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitThinkingDeltaUpdate(
  state: SessionListenerState,
  messageId: string,
  assistantEvent: ThinkingDeltaAssistantEvent,
): void {
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
): void {
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
): void {
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
): void {
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
): void {
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

function handleMessageUpdate(state: SessionListenerState, event: MessageUpdateSessionEvent): void {
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

function handleToolExecutionStart(
  state: SessionListenerState,
  event: ToolExecutionStartSessionEvent,
): void {
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
): void {
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

function handleToolExecutionEnd(
  state: SessionListenerState,
  event: ToolExecutionEndSessionEvent,
): void {
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

function handleMessageEnd(state: SessionListenerState, event: MessageEndSessionEvent): void {
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

function emitQueueUpdate(state: SessionListenerState, event: QueueUpdateSessionEvent): void {
  emitEvent(state.input.onEvent, {
    type: 'queue_update',
    steering: [...event.steering],
    followUp: [...event.followUp],
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitCompactionStart(
  state: SessionListenerState,
  event: CompactionStartSessionEvent,
): void {
  emitEvent(state.input.onEvent, {
    type: 'compaction_start',
    reason: event.reason,
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitCompactionEnd(state: SessionListenerState, event: CompactionEndSessionEvent): void {
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

function emitAutoRetryStart(state: SessionListenerState, event: AutoRetryStartSessionEvent): void {
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

function emitAutoRetryEnd(state: SessionListenerState, event: AutoRetryEndSessionEvent): void {
  emitEvent(state.input.onEvent, {
    type: 'auto_retry_end',
    success: event.success,
    attempt: event.attempt,
    ...(event.finalError ? { finalError: event.finalError } : {}),
    timestamp: Date.now(),
    model: state.input.model,
  })
}

function emitAgentEnd(state: SessionListenerState, event: AgentEndSessionEvent): void {
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

function handleSessionEvent(state: SessionListenerState, event: AgentSessionEvent): void {
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

export function createSessionListener(
  input: SessionListenerInput,
  runId: string,
): (event: AgentSessionEvent) => void {
  const state: SessionListenerState = {
    input,
    runId,
    currentMessageId: null,
    thinkingSteps: new Set<string>(),
    startedToolCalls: new Set<string>(),
    toolCallInputs: new Map<string, JsonValue>(),
  }

  return (event) => handleSessionEvent(state, event)
}

function resolvePiRuntimeThinkingLevel(
  model: PiModel,
  requestedThinkingLevel: ThinkingLevel,
): ThinkingLevel {
  return clampThinkingLevel(requestedThinkingLevel, getPiModelAvailableThinkingLevels(model))
}

async function createPiSessionForRun(input: {
  readonly services: AgentSessionServices
  readonly model: PiModel
  readonly sessionManager: SessionManager
  readonly thinkingLevel: ThinkingLevel
}) {
  const hasExistingMessages = input.sessionManager.buildSessionContext().messages.length > 0
  const result = hasExistingMessages
    ? await createOpenWaggleAgentSessionFromServices({
        services: input.services,
        model: input.model,
        sessionManager: input.sessionManager,
      })
    : await createOpenWaggleAgentSessionFromServices({
        services: input.services,
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        sessionManager: input.sessionManager,
      })

  if (hasExistingMessages) {
    result.session.setThinkingLevel(input.thinkingLevel)
  }

  return result
}

async function createPiRunSessionRuntime(input: {
  readonly session: SessionDetail
  readonly projectPath: string
  readonly payload: HydratedAgentSendPayload
  readonly modelReference: SupportedModelId
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly extensionFactories?: readonly ExtensionFactory[]
}): Promise<PiRunSessionRuntime> {
  const { model, services } = await createPiProjectModelRuntime({
    projectPath: input.projectPath,
    modelReference: input.modelReference,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.extensionFactories ? { extensionFactories: [...input.extensionFactories] } : {}),
  })
  const sessionManager = createSessionManagerForSession(input.session, input.projectPath)
  const thinkingLevel = resolvePiRuntimeThinkingLevel(model, input.payload.thinkingLevel)
  const { session } = await createPiSessionForRun({
    services,
    model,
    sessionManager,
    thinkingLevel,
  })

  return { model, session }
}

function createAbortListener(session: AgentSession, warning: string): () => void {
  return () => {
    void abortPiSession(session, warning)
  }
}

async function abortPiSession(session: AgentSession, warning: string): Promise<void> {
  await session.abort().catch((error) => {
    logger.warn(warning, {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

function buildSuccessfulRunResult(input: {
  readonly session: AgentSession
  readonly payload: HydratedAgentSendPayload
  readonly appended: readonly unknown[]
  readonly signal: AbortSignal
}): AgentKernelRunResult {
  const terminalError = extractPiAssistantTerminalError(input.appended)
  const stopReason = getPiAssistantStopReason(input.appended)

  return {
    newMessages: buildPiRunNewMessages(input.payload, input.appended),
    piSessionId: input.session.sessionId,
    piSessionFile: input.session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(input.session),
    ...(stopReason === 'aborted' || input.signal.aborted ? { aborted: true } : {}),
    ...(terminalError ? { terminalError } : {}),
  }
}

function buildFailedRunResult(input: {
  readonly session: AgentSession
  readonly newMessages: readonly Message[]
  readonly aborted: boolean
  readonly message: string
}): AgentKernelRunResult {
  return {
    newMessages: input.newMessages,
    piSessionId: input.session.sessionId,
    piSessionFile: input.session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(input.session),
    ...(input.aborted ? { aborted: true } : { terminalError: input.message }),
  }
}

async function abortPreCancelledRun(
  session: AgentSession,
  warning: string,
): Promise<AgentKernelRunResult> {
  await abortPiSession(session, warning)
  return {
    newMessages: [],
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session),
    aborted: true,
  }
}

async function promptPiSession(
  session: AgentSession,
  model: PiModel,
  payload: HydratedAgentSendPayload,
): Promise<void> {
  const promptInput = buildPiPromptInput(model, payload)
  await session.prompt(
    promptInput.text,
    promptInput.images.length > 0 ? { images: [...promptInput.images] } : undefined,
  )
}

async function runSubscribedPiOperation(input: {
  readonly runInput: AgentKernelRunInput
  readonly session: AgentSession
  readonly unsubscribe: () => void
  readonly abortWarning: string
  readonly preAbortWarning: string
  readonly operation: () => Promise<void>
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}): Promise<AgentKernelRunResult> {
  const abortListener = createAbortListener(input.session, input.abortWarning)
  let previousMessageCount = input.session.agent.state.messages.length

  if (input.runInput.signal.aborted) {
    const result = await abortPreCancelledRun(input.session, input.preAbortWarning)
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
    return result
  }

  input.runInput.signal.addEventListener('abort', abortListener, { once: true })

  try {
    previousMessageCount = input.session.agent.state.messages.length
    await input.operation()
    const appended = input.session.agent.state.messages.slice(previousMessageCount)
    return buildSuccessfulRunResult({
      session: input.session,
      payload: input.runInput.payload,
      appended,
      signal: input.runInput.signal,
    })
  } catch (error) {
    const appended = input.session.agent.state.messages.slice(previousMessageCount)
    const stopReason = getPiAssistantStopReason(appended)
    const aborted = input.runInput.signal.aborted || stopReason === 'aborted'
    const message = error instanceof Error ? error.message : String(error)
    emitEvent(input.runInput.onEvent, {
      type: 'agent_end',
      runId: input.runInput.runId,
      reason: aborted ? 'aborted' : 'error',
      ...(aborted ? {} : { error: { message } }),
      timestamp: Date.now(),
      model: input.runInput.model,
    })
    return buildFailedRunResult({
      session: input.session,
      newMessages: input.buildErrorMessages(appended),
      aborted,
      message,
    })
  } finally {
    input.runInput.signal.removeEventListener('abort', abortListener)
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
  }
}

async function sendInitialWaggleMessages(
  session: AgentSession,
  model: PiModel,
  input: AgentKernelWaggleRunInput,
): Promise<void> {
  await session.sendCustomMessage(
    {
      customType: WAGGLE_VISIBLE_USER_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(buildPiPromptInput(model, input.payload)),
      display: true,
      details: { source: 'openwaggle', kind: 'waggle-user-request' },
    },
    { triggerTurn: false },
  )

  await session.sendCustomMessage(
    {
      customType: WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(
        buildPiPromptInput(
          model,
          buildWaggleTurnPayload(input.payload, {
            config: input.config,
            agentIndex: 0,
            turnNumber: 0,
          }),
        ),
      ),
      display: false,
      details: { source: 'openwaggle', kind: 'waggle-turn', turnNumber: 0, agentIndex: 0 },
    },
    { triggerTurn: true },
  )
}

async function runPiSession(input: AgentKernelRunInput) {
  const projectPath = resolveProjectPath(input)
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    modelReference: input.model,
    payload: input.payload,
    skillToggles: input.skillToggles,
  })

  const runId = input.runId
  const unsubscribe = session.subscribe(createSessionListener(input, runId))
  return runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi session cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi session cleanly',
    operation: () => promptPiSession(session, model, input.payload),
    buildErrorMessages: (appended) => buildPiRunNewMessages(input.payload, appended),
  })
}

function piPromptInputToCustomContent(input: PiPromptInput): PiCustomContent {
  if (input.images.length === 0) {
    return input.text
  }

  return input.text ? [{ type: 'text', text: input.text }, ...input.images] : [...input.images]
}

function buildWaggleTurnPayload(
  payload: HydratedAgentSendPayload,
  input: {
    readonly config: AgentKernelWaggleRunInput['config']
    readonly agentIndex: number
    readonly turnNumber: number
  },
): HydratedAgentSendPayload {
  const agent = input.config.agents[input.agentIndex]
  const otherAgent = input.config.agents[input.agentIndex === 0 ? 1 : 0]
  const lines = [
    `You are "${agent.label}". ${agent.roleDescription}`,
    '',
    `You are collaborating with "${otherAgent.label}" (${otherAgent.roleDescription}).`,
    `This is turn ${String(input.turnNumber + 1)} of the collaboration.`,
    '',
    'Guidelines:',
    '- Use tools to inspect real files and project state before making claims.',
    '- Build on previous contributions rather than repeating them.',
    '- If you agree with the other agent, say so explicitly and briefly.',
    '- If you disagree, explain your reasoning with references to actual code.',
    '- Focus on adding new value each turn.',
    '- End your turn with a concise, direct summary of your findings and position.',
  ]

  if (input.turnNumber > 0) {
    lines.push(
      '',
      'Review the session above and continue the collaboration.',
      'If the other agent made claims about the code, verify them by reading relevant files.',
      'Focus on your role and perspective.',
    )
  }

  return {
    ...payload,
    text: `${lines.join('\n')}\n\n---\n\nUser request:\n${payload.text}`,
    attachments: [],
  }
}

function buildWaggleTurnCompletion(
  meta: AgentKernelWaggleTurnCompletion['meta'],
  messages: readonly unknown[],
): AgentKernelWaggleTurnCompletion {
  const assistantMessages = buildPiRunAssistantMessages(messages)
  const responseText = assistantMessages.map(getMessageText).join('\n\n')
  const hasToolCalls = assistantMessages.some((message) => message.parts.some(isToolCallPart))
  const terminalError = extractPiAssistantTerminalError(messages)

  return {
    meta,
    assistantMessages,
    responseText,
    hasToolCalls,
    ...(terminalError ? { terminalError } : {}),
  }
}

function withTransportEventModel(
  event: AgentTransportEvent,
  meta: AgentKernelWaggleTurnCompletion['meta'],
): AgentTransportEvent {
  return { ...event, model: meta.agentModel }
}

function getWaggleTurnAgentIndex(
  config: AgentKernelWaggleRunInput['config'],
  turnNumber: number,
): number {
  return turnNumber % config.agents.length
}

function emitWaggleTurnStart(
  input: AgentKernelWaggleRunInput,
  meta: AgentKernelWaggleTurnCompletion['meta'],
): void {
  input.onTurnEvent({
    type: 'turn-start',
    turnNumber: meta.turnNumber,
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
  })
}

async function sendWaggleTurnMessage(input: {
  readonly pi: ExtensionAPI
  readonly ctx: Pick<ExtensionContext, 'modelRegistry'>
  readonly payload: HydratedAgentSendPayload
  readonly config: AgentKernelWaggleRunInput['config']
  readonly turnNumber: number
}): Promise<void> {
  const agentIndex = getWaggleTurnAgentIndex(input.config, input.turnNumber)
  const agent = input.config.agents[agentIndex]
  const modelReference = createModelRefFromSupportedModelId(agent.model)
  const model = input.ctx.modelRegistry.find(modelReference.provider, modelReference.id)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${String(agent.model)}`)
  }

  const modelChanged = await input.pi.setModel(model)
  if (!modelChanged) {
    throw new Error(`Pi model ${String(agent.model)} is not available for Waggle mode`)
  }

  const turnPayload = buildWaggleTurnPayload(input.payload, {
    config: input.config,
    agentIndex,
    turnNumber: input.turnNumber,
  })
  input.pi.sendMessage(
    {
      customType: WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(buildPiPromptInput(model, turnPayload)),
      display: false,
      details: {
        source: 'openwaggle',
        kind: 'waggle-turn',
        turnNumber: input.turnNumber,
        agentIndex,
      },
    },
    { triggerTurn: true, deliverAs: 'followUp' },
  )
}

function createModelRefFromSupportedModelId(modelReference: string): {
  readonly provider: string
  readonly id: string
} {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }
  return {
    provider: modelReference.slice(0, separatorIndex),
    id: modelReference.slice(separatorIndex + 1),
  }
}

function createWaggleExtension(input: {
  readonly runInput: AgentKernelWaggleRunInput
  readonly payload: HydratedAgentSendPayload
  readonly loopDone: Deferred
  readonly updateMeta: (meta: AgentKernelWaggleTurnCompletion['meta']) => void
}): ExtensionFactory {
  return (pi) => {
    let turnNumber = 0
    let stopped = false

    pi.on('agent_end', async (event, ctx) => {
      if (stopped) {
        return
      }

      try {
        const agentIndex = getWaggleTurnAgentIndex(input.runInput.config, turnNumber)
        const meta = input.runInput.createTurnMetadata({ turnNumber, agentIndex })
        const decision = await input.runInput.onTurnComplete(
          buildWaggleTurnCompletion(meta, event.messages),
        )
        const nextTurnNumber = turnNumber + 1
        if (!decision.continue || nextTurnNumber >= input.runInput.config.stop.maxTurnsSafety) {
          stopped = true
          input.loopDone.resolve()
          return
        }

        turnNumber = nextTurnNumber
        const nextAgentIndex = getWaggleTurnAgentIndex(input.runInput.config, turnNumber)
        const nextMeta = input.runInput.createTurnMetadata({
          turnNumber,
          agentIndex: nextAgentIndex,
        })
        input.updateMeta(nextMeta)
        emitWaggleTurnStart(input.runInput, nextMeta)
        await sendWaggleTurnMessage({
          pi,
          ctx,
          payload: input.payload,
          config: input.runInput.config,
          turnNumber,
        })
      } catch (error) {
        stopped = true
        input.loopDone.reject(error)
      }
    })
  }
}

async function runPiWaggle(input: AgentKernelWaggleRunInput) {
  const projectPath = resolveProjectPath(input)
  const loopDone = createDeferred()
  let currentMeta = input.createTurnMetadata({ turnNumber: 0, agentIndex: 0 })
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    modelReference: input.config.agents[0]?.model ?? input.model,
    payload: input.payload,
    skillToggles: input.skillToggles,
    extensionFactories: [
      createWaggleExtension({
        runInput: input,
        payload: input.payload,
        loopDone,
        updateMeta: (meta) => {
          currentMeta = meta
        },
      }),
    ],
  })

  const runId = input.runId
  const unsubscribe = session.subscribe(
    createSessionListener(
      {
        ...input,
        model: input.config.agents[0].model,
        onEvent: (event) =>
          input.onWaggleEvent(withTransportEventModel(event, currentMeta), currentMeta),
      },
      runId,
    ),
  )
  return runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi Waggle turn cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi Waggle turn cleanly',
    operation: async () => {
      emitWaggleTurnStart(input, currentMeta)
      await sendInitialWaggleMessages(session, model, input)
      await loopDone.promise
    },
    buildErrorMessages: buildPiRunAssistantMessages,
  })
}

function createSessionManagerForSession(
  session: SessionDetail,
  projectPath: string,
): SessionManager {
  if (session.piSessionFile && existsSync(session.piSessionFile)) {
    return SessionManager.open(session.piSessionFile, undefined, projectPath)
  }

  const sessionManager = SessionManager.create(projectPath)
  if (session.piSessionId) {
    sessionManager.newSession({ id: session.piSessionId })
  }
  return sessionManager
}

type PiSessionOperation<T> = (session: AgentSession) => T | Promise<T>

async function withPiSession<T>(
  input: AgentKernelSessionInput,
  operation: PiSessionOperation<T>,
): Promise<T> {
  const projectPath = resolveSessionProjectPath(input.session)
  const { model, services } = await createPiProjectModelRuntime({
    projectPath,
    modelReference: input.model,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
  })
  const sessionManager = createSessionManagerForSession(input.session, projectPath)
  const { session } = await createOpenWaggleAgentSessionFromServices({
    services,
    model,
    sessionManager,
  })

  try {
    return await operation(session)
  } finally {
    await disposeOpenWagglePiSession(session)
  }
}

async function createPiSessionRuntime(input: AgentKernelSessionInput) {
  const projectPath = resolveSessionProjectPath(input.session)
  const initialSessionManager = createSessionManagerForSession(input.session, projectPath)
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const { model, services } = await createPiProjectModelRuntime({
      projectPath: options.cwd,
      modelReference: input.model,
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    })
    const runtime = await createOpenWaggleAgentSessionFromServices({
      services,
      model,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
    })

    return {
      ...runtime,
      services,
      diagnostics: services.diagnostics,
    }
  }

  return createAgentSessionRuntime(createRuntime, {
    cwd: projectPath,
    agentDir: getPiAgentDir(),
    sessionManager: initialSessionManager,
  })
}

function toContextUsageSnapshot(usage: ContextUsage | undefined): ContextUsageSnapshot | null {
  if (!usage) {
    return null
  }

  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
  }
}

async function getPiContextUsage(
  input: AgentKernelSessionInput,
): Promise<ContextUsageSnapshot | null> {
  return withPiSession(input, (session) => toContextUsageSnapshot(session.getContextUsage()))
}

async function getPiSessionSnapshot(input: AgentKernelSessionInput) {
  return withPiSession(input, (session) => ({
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session),
  }))
}

async function compactPiSession(
  input: CompactAgentKernelSessionInput,
): Promise<AgentKernelCompactResult> {
  return withPiSession(input, async (session) => {
    const unsubscribe = input.onEvent
      ? session.subscribe(
          createSessionListener(
            {
              model: input.model,
              onEvent: input.onEvent,
            },
            randomUUID(),
          ),
        )
      : undefined

    const abortListener = () => {
      session.abortCompaction()
    }
    input.signal?.addEventListener('abort', abortListener, { once: true })
    if (input.signal?.aborted) {
      session.abortCompaction()
    }

    try {
      const result = await session.compact(input.customInstructions)
      return {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session),
      }
    } finally {
      input.signal?.removeEventListener('abort', abortListener)
      unsubscribe?.()
    }
  })
}

async function navigatePiSessionTree(input: NavigateAgentKernelSessionInput) {
  return withPiSession(input, async (session) => {
    try {
      const result = await session.navigateTree(input.targetNodeId, {
        summarize: input.summarize ?? false,
        customInstructions: input.customInstructions,
      })
      return {
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session),
        editorText: result.editorText,
        cancelled: result.cancelled,
      }
    } catch (error) {
      if (error instanceof Error && error.message === `Entry ${input.targetNodeId} not found`) {
        throw new AgentKernelMissingEntryError(input.targetNodeId)
      }
      throw error
    }
  })
}

async function forkPiSession(
  input: ForkAgentKernelSessionInput,
): Promise<AgentKernelForkSessionResult> {
  const runtime = await createPiSessionRuntime(input)
  try {
    const result = await withOpenWagglePiSessionLifecycleContext(runtime.session, () =>
      runtime.fork(input.targetNodeId, { position: input.position }),
    )
    if (result.cancelled) {
      return {
        cancelled: true,
        piSessionId: runtime.session.sessionId,
        piSessionFile: runtime.session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(runtime.session),
      }
    }

    return {
      cancelled: false,
      piSessionId: runtime.session.sessionId,
      piSessionFile: runtime.session.sessionFile,
      sessionSnapshot: projectPiSessionSnapshot(runtime.session),
      ...(result.selectedText ? { editorText: result.selectedText } : {}),
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Invalid entry ID for forking' ||
        error.message === `Entry ${input.targetNodeId} not found`)
    ) {
      throw new AgentKernelMissingEntryError(input.targetNodeId)
    }
    throw error
  } finally {
    await disposeOpenWagglePiSession(runtime.session)
  }
}

async function createPiSession(projectPath: string) {
  const sessionManager = SessionManager.create(projectPath)
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: sessionManager.getSessionFile(),
  }
}

export const PiAgentKernelLive = Layer.succeed(
  AgentKernelService,
  AgentKernelService.of({
    createSession: (input) =>
      Effect.tryPromise({
        try: () => createPiSession(input.projectPath),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    run: (input: AgentKernelRunInput) =>
      Effect.tryPromise({
        try: () => runPiSession(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    runWaggle: (input: AgentKernelWaggleRunInput) =>
      Effect.tryPromise({
        try: () => runPiWaggle(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    getContextUsage: (input: AgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => getPiContextUsage(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    getSessionSnapshot: (input: AgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => getPiSessionSnapshot(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    compact: (input: CompactAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => compactPiSession(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    navigateTree: (input: NavigateAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => navigatePiSessionTree(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),

    forkSession: (input: ForkAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => forkPiSession(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)
