import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { matchBy } from '@diegogbrisa/ts-match'
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
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import {
  getMessageText,
  type HydratedAgentSendPayload,
  isToolCallPart,
  type Message,
  type MessagePart,
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
import { getOpenWaggleCorePiExtensionPaths } from './pi-mcp-adapter'
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

type PiSessionEntry<TType extends SessionEntry['type']> = Extract<SessionEntry, { type: TType }>

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

function fallbackTextParts(): MessagePart[] {
  return [textMessagePart('')]
}

function getPiImageBlockLabel(block: Readonly<Record<string, unknown>>): string {
  return typeof block.mimeType === 'string' ? block.mimeType : 'image'
}

function piContentBlockToPart(block: unknown): MessagePart | null {
  if (!isRecord(block)) {
    return null
  }

  if (block.type === 'text' && typeof block.text === 'string') {
    return textMessagePart(block.text)
  }

  if (block.type === 'image') {
    return textMessagePart(`[Image input: ${getPiImageBlockLabel(block)}]`)
  }

  return null
}

function piTextAndImageContentToParts(content: unknown): MessagePart[] {
  if (typeof content === 'string') {
    return [textMessagePart(content)]
  }

  if (!Array.isArray(content)) {
    return fallbackTextParts()
  }

  const parts: MessagePart[] = []
  for (const block of content) {
    const part = piContentBlockToPart(block)
    if (part) {
      parts.push(part)
    }
  }

  return parts.length > 0 ? parts : fallbackTextParts()
}

function piAssistantContentToParts(content: readonly unknown[]): MessagePart[] {
  const parts: MessagePart[] = []

  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      continue
    }

    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push({ type: 'reasoning', text: block.thinking })
      continue
    }

    if (
      block.type === 'toolCall' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      parts.push({
        type: 'tool-call',
        toolCall: {
          id: ToolCallId(block.id),
          name: block.name,
          args: toJsonObject(block.arguments),
          state: 'input-complete',
        },
      })
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

type PiSessionMessage = PiSessionEntry<'message'>['message']
type PiMessage<TRole extends PiSessionMessage['role']> = Extract<PiSessionMessage, { role: TRole }>

type ProjectedEntryDetails = Pick<
  ProjectedSessionNodeInput,
  'kind' | 'role' | 'contentJson' | 'metadataJson'
>

function projectUserPiMessage(message: PiMessage<'user'>): ProjectedEntryDetails {
  const parts = piTextAndImageContentToParts(message.content)
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(parts, null),
    metadataJson: '{}',
  }
}

function projectAssistantPiMessage(message: PiMessage<'assistant'>): ProjectedEntryDetails {
  const parts = piAssistantContentToParts(message.content)
  const model = createModelRef(message.provider, message.model)
  return {
    kind: 'assistant_message',
    role: 'assistant',
    contentJson: buildMessageNodeContentJson(parts, model),
    metadataJson: buildRawNodeContentJson({
      api: message.api,
      provider: message.provider,
      model: message.model,
      usage: toJsonValue(message.usage),
      stopReason: message.stopReason,
      errorMessage: message.errorMessage ?? null,
    }),
  }
}

function projectToolResultPiMessage(message: PiMessage<'toolResult'>): ProjectedEntryDetails {
  return {
    kind: 'tool_result',
    role: null,
    contentJson: buildMessageNodeContentJson([piToolResultContentToPart(message)], null),
    metadataJson: buildRawNodeContentJson({
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: message.isError,
    }),
  }
}

function projectBranchSummaryPiMessage(message: PiMessage<'branchSummary'>): ProjectedEntryDetails {
  return {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: message.summary,
      fromId: message.fromId,
    }),
    metadataJson: '{}',
  }
}

function projectCompactionSummaryPiMessage(
  message: PiMessage<'compactionSummary'>,
): ProjectedEntryDetails {
  return {
    kind: 'compaction_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: message.summary,
      tokensBefore: message.tokensBefore,
    }),
    metadataJson: '{}',
  }
}

function projectBashExecutionPiMessage(message: PiMessage<'bashExecution'>): ProjectedEntryDetails {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      role: message.role,
      command: message.command,
      output: message.output,
      exitCode: message.exitCode ?? null,
      cancelled: message.cancelled,
      truncated: message.truncated,
      fullOutputPath: message.fullOutputPath ?? null,
      excludeFromContext: message.excludeFromContext ?? false,
    }),
    metadataJson: '{}',
  }
}

function projectCustomPiMessage(message: PiMessage<'custom'>): ProjectedEntryDetails {
  return {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      role: message.role,
      customType: message.customType,
      content: toJsonValue(message.content),
      display: message.display,
      details: toJsonValue(message.details ?? null),
    }),
    metadataJson: '{}',
  }
}

function messageProjectionForEntry(entry: PiSessionEntry<'message'>): ProjectedEntryDetails {
  return matchBy(entry.message, 'role')
    .with('user', projectUserPiMessage)
    .with('assistant', projectAssistantPiMessage)
    .with('toolResult', projectToolResultPiMessage)
    .with('branchSummary', projectBranchSummaryPiMessage)
    .with('compactionSummary', projectCompactionSummaryPiMessage)
    .with('bashExecution', projectBashExecutionPiMessage)
    .with('custom', projectCustomPiMessage)
    .exhaustive()
}

interface PiEntryProjectionContext {
  readonly createdOrder: number
  readonly pathDepth: number
  readonly timestampMs: number
}

function buildProjectedPiEntry(
  context: PiEntryProjectionContext,
  entry: SessionEntry,
  details: ProjectedEntryDetails,
): ProjectedSessionNodeInput {
  return {
    id: entry.id,
    parentId: entry.parentId,
    piEntryType: entry.type,
    kind: details.kind,
    role: details.role,
    timestampMs: context.timestampMs,
    contentJson: details.contentJson,
    metadataJson: details.metadataJson,
    pathDepth: context.pathDepth,
    createdOrder: context.createdOrder,
  }
}

function projectMessagePiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'message'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, messageProjectionForEntry(entry))
}

function projectModelChangePiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'model_change'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'model_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      provider: entry.provider,
      modelId: entry.modelId,
      modelRef: createModelRef(entry.provider, entry.modelId),
    }),
    metadataJson: '{}',
  })
}

function projectThinkingLevelChangePiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'thinking_level_change'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'thinking_level_change',
    role: null,
    contentJson: buildRawNodeContentJson({
      thinkingLevel: entry.thinkingLevel,
    }),
    metadataJson: '{}',
  })
}

function projectCompactionPiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'compaction'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
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
  })
}

function projectBranchSummaryPiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'branch_summary'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'branch_summary',
    role: null,
    contentJson: buildRawNodeContentJson({
      summary: entry.summary,
      fromId: entry.fromId,
      details: toJsonValue(entry.details ?? null),
      fromHook: entry.fromHook ?? false,
    }),
    metadataJson: '{}',
  })
}

function projectCustomPiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'custom'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'custom',
    role: null,
    contentJson: buildRawNodeContentJson({
      customType: entry.customType,
      data: toJsonValue(entry.data ?? null),
    }),
    metadataJson: '{}',
  })
}

function projectVisibleWaggleCustomMessagePiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'custom_message'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(piTextAndImageContentToParts(entry.content), null),
    metadataJson: buildRawNodeContentJson({
      customType: entry.customType,
      display: entry.display,
      details: toJsonValue(entry.details ?? null),
    }),
  })
}

function projectCustomMessagePiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'custom_message'>,
): ProjectedSessionNodeInput {
  if (entry.customType === WAGGLE_VISIBLE_USER_CUSTOM_TYPE && entry.display) {
    return projectVisibleWaggleCustomMessagePiEntry(context, entry)
  }

  return buildProjectedPiEntry(context, entry, {
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
  })
}

function projectLabelPiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'label'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'label',
    role: null,
    contentJson: buildRawNodeContentJson({
      targetId: entry.targetId,
      label: entry.label ?? null,
    }),
    metadataJson: '{}',
  })
}

function projectSessionInfoPiEntry(
  context: PiEntryProjectionContext,
  entry: PiSessionEntry<'session_info'>,
): ProjectedSessionNodeInput {
  return buildProjectedPiEntry(context, entry, {
    kind: 'session_info',
    role: null,
    contentJson: buildRawNodeContentJson({
      name: entry.name ?? null,
    }),
    metadataJson: '{}',
  })
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const context: PiEntryProjectionContext = {
    createdOrder: input.createdOrder,
    pathDepth: input.pathDepth,
    timestampMs: parsePiEntryTimestamp(input.entry.timestamp),
  }

  return matchBy(input.entry, 'type')
    .with('message', (entry) => projectMessagePiEntry(context, entry))
    .with('model_change', (entry) => projectModelChangePiEntry(context, entry))
    .with('thinking_level_change', (entry) => projectThinkingLevelChangePiEntry(context, entry))
    .with('compaction', (entry) => projectCompactionPiEntry(context, entry))
    .with('branch_summary', (entry) => projectBranchSummaryPiEntry(context, entry))
    .with('custom', (entry) => projectCustomPiEntry(context, entry))
    .with('custom_message', (entry) => projectCustomMessagePiEntry(context, entry))
    .with('label', (entry) => projectLabelPiEntry(context, entry))
    .with('session_info', (entry) => projectSessionInfoPiEntry(context, entry))
    .exhaustive()
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

type PiToolCallEvent = Extract<
  PiAssistantMessageEvent,
  { type: 'toolcall_start' | 'toolcall_delta' | 'toolcall_end' }
>
type PiToolCallPartialEvent = Extract<
  PiAssistantMessageEvent,
  { type: 'toolcall_start' | 'toolcall_delta' }
>
type PiToolCallDeltaAssistantEvent = Extract<PiAssistantMessageEvent, { type: 'toolcall_delta' }>
type PiToolCallEndAssistantEvent = Extract<PiAssistantMessageEvent, { type: 'toolcall_end' }>
type PiTextDeltaAssistantEvent = Extract<PiAssistantMessageEvent, { type: 'text_delta' }>
type PiThinkingStartAssistantEvent = Extract<PiAssistantMessageEvent, { type: 'thinking_start' }>
type PiThinkingDeltaAssistantEvent = Extract<PiAssistantMessageEvent, { type: 'thinking_delta' }>

function getToolCallFromPartialAssistantEvent(event: PiToolCallPartialEvent): {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
} | null {
  const content = event.partial.content[event.contentIndex]
  if (!content || content.type !== 'toolCall') {
    return null
  }

  return {
    id: content.id,
    name: content.name,
    arguments: content.arguments,
  }
}

function getToolCallFromEndAssistantEvent(event: PiToolCallEndAssistantEvent): {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
} {
  return {
    id: event.toolCall.id,
    name: event.toolCall.name,
    arguments: event.toolCall.arguments,
  }
}

function getToolCallFromAssistantEvent(event: PiToolCallEvent): {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
} | null {
  return matchBy(event, 'type')
    .with('toolcall_end', getToolCallFromEndAssistantEvent)
    .with('toolcall_start', 'toolcall_delta', getToolCallFromPartialAssistantEvent)
    .exhaustive()
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

type PiMessageStartEvent = Extract<AgentSessionEvent, { type: 'message_start' }>
type PiMessageUpdateEvent = Extract<AgentSessionEvent, { type: 'message_update' }>
type PiMessageEndEvent = Extract<AgentSessionEvent, { type: 'message_end' }>
type PiToolExecutionStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }>
type PiToolExecutionUpdateEvent = Extract<AgentSessionEvent, { type: 'tool_execution_update' }>
type PiToolExecutionEndEvent = Extract<AgentSessionEvent, { type: 'tool_execution_end' }>
type PiQueueUpdateEvent = Extract<AgentSessionEvent, { type: 'queue_update' }>
type PiCompactionStartEvent = Extract<AgentSessionEvent, { type: 'compaction_start' }>
type PiCompactionEndEvent = Extract<AgentSessionEvent, { type: 'compaction_end' }>
type PiAutoRetryStartEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>
type PiAutoRetryEndEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>
type PiAgentEndEvent = Extract<AgentSessionEvent, { type: 'agent_end' }>
type PiAssistantMessageEvent = PiMessageUpdateEvent['assistantMessageEvent']
type PiToolCall = NonNullable<ReturnType<typeof getToolCallFromAssistantEvent>>
type TransportAssistantMessageEvent = Extract<
  AgentTransportEvent,
  { type: 'message_update' }
>['assistantMessageEvent']

export function createSessionListener(
  input: SessionListenerInput,
  runId: string,
): (event: AgentSessionEvent) => void {
  let currentMessageId: string | null = null
  const thinkingSteps = new Set<string>()
  const startedToolCalls = new Set<string>()
  const toolCallInputs = new Map<string, JsonValue>()

  function emitTransportEvent(event: AgentTransportEvent): void {
    emitEvent(input.onEvent, event)
  }

  function emitAssistantMessageEvent(
    messageId: string,
    assistantMessageEvent: TransportAssistantMessageEvent,
  ): void {
    emitTransportEvent({
      type: 'message_update',
      messageId,
      role: 'assistant',
      assistantMessageEvent,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function emitMessageStart(messageId: string): void {
    emitTransportEvent({
      type: 'message_start',
      messageId,
      role: 'assistant',
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function ensureAssistantMessageId(): string {
    if (!currentMessageId) {
      currentMessageId = createStreamingMessageId()
      emitMessageStart(currentMessageId)
    }
    return currentMessageId
  }

  function getThinkingStepId(messageId: string, contentIndex: number): string {
    return `${messageId}:thinking:${String(contentIndex)}`
  }

  function emitThinkingStartIfNeeded(messageId: string, contentIndex: number): void {
    const stepId = getThinkingStepId(messageId, contentIndex)
    if (thinkingSteps.has(stepId)) {
      return
    }

    thinkingSteps.add(stepId)
    emitAssistantMessageEvent(messageId, {
      type: 'thinking_start',
      contentIndex,
    })
  }

  function emitToolCallStart(messageId: string, contentIndex: number, toolCall: PiToolCall): void {
    if (startedToolCalls.has(toolCall.id)) {
      return
    }

    const toolInput = toJsonValue(toolCall.arguments)
    startedToolCalls.add(toolCall.id)
    toolCallInputs.set(toolCall.id, toolInput)
    emitAssistantMessageEvent(messageId, {
      type: 'toolcall_start',
      contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolInput,
    })
  }

  function handleAgentStart(): void {
    emitTransportEvent({
      type: 'agent_start',
      runId,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleMessageStart(event: PiMessageStartEvent): void {
    if (event.message.role !== 'assistant') {
      return
    }

    currentMessageId = createStreamingMessageId()
    emitMessageStart(currentMessageId)
  }

  function handleTextDelta(messageId: string, assistantEvent: PiTextDeltaAssistantEvent): void {
    emitAssistantMessageEvent(messageId, {
      type: 'text_delta',
      contentIndex: assistantEvent.contentIndex,
      delta: assistantEvent.delta,
    })
  }

  function handleThinkingStart(
    messageId: string,
    assistantEvent: PiThinkingStartAssistantEvent,
  ): void {
    emitThinkingStartIfNeeded(messageId, assistantEvent.contentIndex)
  }

  function handleThinkingDelta(
    messageId: string,
    assistantEvent: PiThinkingDeltaAssistantEvent,
  ): void {
    emitThinkingStartIfNeeded(messageId, assistantEvent.contentIndex)
    emitAssistantMessageEvent(messageId, {
      type: 'thinking_delta',
      contentIndex: assistantEvent.contentIndex,
      delta: assistantEvent.delta,
    })
  }

  function handleToolCallStart(messageId: string, assistantEvent: PiToolCallPartialEvent): void {
    const toolCall = getToolCallFromAssistantEvent(assistantEvent)
    if (toolCall) {
      emitToolCallStart(messageId, assistantEvent.contentIndex, toolCall)
    }
  }

  function handleToolCallDelta(
    messageId: string,
    assistantEvent: PiToolCallDeltaAssistantEvent,
  ): void {
    const toolCall = getToolCallFromAssistantEvent(assistantEvent)
    if (!toolCall) {
      return
    }

    emitToolCallStart(messageId, assistantEvent.contentIndex, toolCall)
    const toolInput = toJsonValue(toolCall.arguments)
    toolCallInputs.set(toolCall.id, toolInput)
    emitAssistantMessageEvent(messageId, {
      type: 'toolcall_delta',
      contentIndex: assistantEvent.contentIndex,
      toolCallId: toolCall.id,
      delta: assistantEvent.delta,
      input: toolInput,
    })
  }

  function handleToolCallEnd(messageId: string, assistantEvent: PiToolCallEndAssistantEvent): void {
    const toolCall = getToolCallFromAssistantEvent(assistantEvent)
    if (!toolCall) {
      return
    }

    emitToolCallStart(messageId, assistantEvent.contentIndex, toolCall)
    const toolInput = toJsonValue(toolCall.arguments)
    toolCallInputs.set(toolCall.id, toolInput)
    emitAssistantMessageEvent(messageId, {
      type: 'toolcall_end',
      contentIndex: assistantEvent.contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolInput,
    })
  }

  function handleMessageUpdate(event: PiMessageUpdateEvent): void {
    const messageId = ensureAssistantMessageId()

    matchBy(event.assistantMessageEvent, 'type')
      .with('text_delta', (assistantEvent) => handleTextDelta(messageId, assistantEvent))
      .with('thinking_start', (assistantEvent) => handleThinkingStart(messageId, assistantEvent))
      .with('thinking_delta', (assistantEvent) => handleThinkingDelta(messageId, assistantEvent))
      .with('toolcall_start', (assistantEvent) => handleToolCallStart(messageId, assistantEvent))
      .with('toolcall_delta', (assistantEvent) => handleToolCallDelta(messageId, assistantEvent))
      .with('toolcall_end', (assistantEvent) => handleToolCallEnd(messageId, assistantEvent))
      .with('start', 'text_start', 'text_end', 'thinking_end', 'done', 'error', () => undefined)
      .exhaustive()
  }

  function handleToolExecutionStart(event: PiToolExecutionStartEvent): void {
    const toolInput = toJsonValue(event.args)
    toolCallInputs.set(event.toolCallId, toolInput)
    emitTransportEvent({
      type: 'tool_execution_start',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: toolInput,
      parentMessageId: currentMessageId ?? undefined,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleToolExecutionUpdate(event: PiToolExecutionUpdateEvent): void {
    const toolInput = toJsonValue(event.args)
    toolCallInputs.set(event.toolCallId, toolInput)
    emitTransportEvent({
      type: 'tool_execution_update',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: toolInput,
      partialResult: toJsonValue(event.partialResult),
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleToolExecutionEnd(event: PiToolExecutionEndEvent): void {
    emitTransportEvent({
      type: 'tool_execution_end',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: toolCallInputs.get(event.toolCallId),
      result: toJsonValue(event.result),
      isError: event.isError,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleMessageEnd(event: PiMessageEndEvent): void {
    if (!currentMessageId || event.message.role !== 'assistant') {
      return
    }

    emitTransportEvent({
      type: 'message_end',
      messageId: currentMessageId,
      role: 'assistant',
      timestamp: Date.now(),
      model: input.model,
    })
    currentMessageId = null
  }

  function handleQueueUpdate(event: PiQueueUpdateEvent): void {
    emitTransportEvent({
      type: 'queue_update',
      steering: [...event.steering],
      followUp: [...event.followUp],
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleCompactionStart(event: PiCompactionStartEvent): void {
    emitTransportEvent({
      type: 'compaction_start',
      reason: event.reason,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleCompactionEnd(event: PiCompactionEndEvent): void {
    emitTransportEvent({
      type: 'compaction_end',
      reason: event.reason,
      result: toJsonValue(event.result ?? null),
      aborted: event.aborted,
      willRetry: event.willRetry,
      ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleAutoRetryStart(event: PiAutoRetryStartEvent): void {
    emitTransportEvent({
      type: 'auto_retry_start',
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleAutoRetryEnd(event: PiAutoRetryEndEvent): void {
    emitTransportEvent({
      type: 'auto_retry_end',
      success: event.success,
      attempt: event.attempt,
      ...(event.finalError ? { finalError: event.finalError } : {}),
      timestamp: Date.now(),
      model: input.model,
    })
  }

  function handleAgentEnd(event: PiAgentEndEvent): void {
    const reason = getAgentEndReason(event.messages)
    const error =
      reason === 'error' || reason === 'aborted' ? getAgentEndError(event.messages) : undefined
    emitTransportEvent({
      type: 'agent_end',
      runId,
      reason,
      usage: getAgentEndUsage(event.messages),
      ...(error ? { error } : {}),
      timestamp: Date.now(),
      model: input.model,
    })
  }

  return (event) => {
    matchBy(event, 'type')
      .with('agent_start', handleAgentStart)
      .with('message_start', handleMessageStart)
      .with('message_update', handleMessageUpdate)
      .with('tool_execution_start', handleToolExecutionStart)
      .with('tool_execution_update', handleToolExecutionUpdate)
      .with('tool_execution_end', handleToolExecutionEnd)
      .with('message_end', handleMessageEnd)
      .with('queue_update', handleQueueUpdate)
      .with('compaction_start', handleCompactionStart)
      .with('compaction_end', handleCompactionEnd)
      .with('auto_retry_start', handleAutoRetryStart)
      .with('auto_retry_end', handleAutoRetryEnd)
      .with('agent_end', handleAgentEnd)
      .with('turn_start', 'turn_end', () => undefined)
      .exhaustive()
  }
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
    ? await createAgentSessionFromServices({
        services: input.services,
        model: input.model,
        sessionManager: input.sessionManager,
      })
    : await createAgentSessionFromServices({
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
  readonly mcpEnabled: boolean
}): Promise<PiRunSessionRuntime> {
  const { model, services } = await createPiProjectModelRuntime({
    projectPath: input.projectPath,
    modelReference: input.modelReference,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    extensionPaths: getOpenWaggleCorePiExtensionPaths({ mcpEnabled: input.mcpEnabled }),
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
    input.session.dispose()
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
    input.session.dispose()
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
    mcpEnabled: input.mcpEnabled,
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
    mcpEnabled: input.mcpEnabled,
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
    extensionPaths: getOpenWaggleCorePiExtensionPaths({ mcpEnabled: input.mcpEnabled }),
  })
  const sessionManager = createSessionManagerForSession(input.session, projectPath)
  const { session } = await createAgentSessionFromServices({
    services,
    model,
    sessionManager,
  })

  try {
    return await operation(session)
  } finally {
    session.dispose()
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
      extensionPaths: getOpenWaggleCorePiExtensionPaths({ mcpEnabled: input.mcpEnabled }),
    })
    const runtime = await createAgentSessionFromServices({
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
    const result = await runtime.fork(input.targetNodeId, { position: input.position })
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
    await runtime.dispose()
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
