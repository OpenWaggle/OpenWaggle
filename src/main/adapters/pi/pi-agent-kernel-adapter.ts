import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
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

function piTextAndImageContentToParts(content: unknown): MessagePart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [{ type: 'text', text: '' }]
  }

  if (!Array.isArray(content)) {
    return [{ type: 'text', text: '' }]
  }

  const parts: MessagePart[] = []
  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      continue
    }

    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'image') {
      const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'image'
      parts.push({ type: 'text', text: `[Image input: ${mimeType}]` })
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
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

function messageProjectionForEntry(entry: Extract<SessionEntry, { type: 'message' }>): {
  readonly kind: ProjectedSessionNodeInput['kind']
  readonly role: MessageRole | null
  readonly contentJson: string
  readonly metadataJson: string
} {
  const message = entry.message

  if (message.role === 'user') {
    const parts = piTextAndImageContentToParts(message.content)
    return {
      kind: 'user_message',
      role: 'user',
      contentJson: buildMessageNodeContentJson(parts, null),
      metadataJson: '{}',
    }
  }

  if (message.role === 'assistant') {
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

  if (message.role === 'toolResult') {
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

  if (message.role === 'branchSummary') {
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

  if (message.role === 'compactionSummary') {
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

  if (message.role === 'bashExecution') {
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

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)

  if (input.entry.type === 'message') {
    const projectedMessage = messageProjectionForEntry(input.entry)
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: projectedMessage.kind,
      role: projectedMessage.role,
      timestampMs,
      contentJson: projectedMessage.contentJson,
      metadataJson: projectedMessage.metadataJson,
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'model_change') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'model_change',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        provider: input.entry.provider,
        modelId: input.entry.modelId,
        modelRef: createModelRef(input.entry.provider, input.entry.modelId),
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'thinking_level_change') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'thinking_level_change',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        thinkingLevel: input.entry.thinkingLevel,
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'compaction') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'compaction_summary',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        summary: input.entry.summary,
        firstKeptEntryId: input.entry.firstKeptEntryId,
        tokensBefore: input.entry.tokensBefore,
        details: toJsonValue(input.entry.details ?? null),
        fromHook: input.entry.fromHook ?? false,
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'branch_summary') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'branch_summary',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        summary: input.entry.summary,
        fromId: input.entry.fromId,
        details: toJsonValue(input.entry.details ?? null),
        fromHook: input.entry.fromHook ?? false,
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'custom') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'custom',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        customType: input.entry.customType,
        data: toJsonValue(input.entry.data ?? null),
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (
    input.entry.type === 'custom_message' &&
    input.entry.customType === WAGGLE_VISIBLE_USER_CUSTOM_TYPE &&
    input.entry.display
  ) {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'user_message',
      role: 'user',
      timestampMs,
      contentJson: buildMessageNodeContentJson(
        piTextAndImageContentToParts(input.entry.content),
        null,
      ),
      metadataJson: buildRawNodeContentJson({
        customType: input.entry.customType,
        display: input.entry.display,
        details: toJsonValue(input.entry.details ?? null),
      }),
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'custom_message') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'custom',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        customType: input.entry.customType,
        content: toJsonValue(input.entry.content),
        display: input.entry.display,
        details: toJsonValue(input.entry.details ?? null),
      }),
      metadataJson: buildRawNodeContentJson({
        customType: input.entry.customType,
        display: input.entry.display,
        details: toJsonValue(input.entry.details ?? null),
      }),
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  if (input.entry.type === 'label') {
    return {
      id: input.entry.id,
      parentId: input.entry.parentId,
      piEntryType: input.entry.type,
      kind: 'label',
      role: null,
      timestampMs,
      contentJson: buildRawNodeContentJson({
        targetId: input.entry.targetId,
        label: input.entry.label ?? null,
      }),
      metadataJson: '{}',
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    }
  }

  return {
    id: input.entry.id,
    parentId: input.entry.parentId,
    piEntryType: input.entry.type,
    kind: 'session_info',
    role: null,
    timestampMs,
    contentJson: buildRawNodeContentJson({
      name: input.entry.name ?? null,
    }),
    metadataJson: '{}',
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
  if (event.type !== 'message_update') {
    return null
  }

  const assistantEvent = event.assistantMessageEvent
  if (assistantEvent.type === 'toolcall_end') {
    return {
      id: assistantEvent.toolCall.id,
      name: assistantEvent.toolCall.name,
      arguments: assistantEvent.toolCall.arguments,
    }
  }

  if (
    (assistantEvent.type !== 'toolcall_start' && assistantEvent.type !== 'toolcall_delta') ||
    !('partial' in assistantEvent)
  ) {
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

export function createSessionListener(
  input: SessionListenerInput,
  runId: string,
): (event: AgentSessionEvent) => void {
  let currentMessageId: string | null = null
  const thinkingSteps = new Set<string>()
  const startedToolCalls = new Set<string>()
  const toolCallInputs = new Map<string, JsonValue>()

  function emitToolCallStart(
    messageId: string,
    contentIndex: number,
    toolCall: NonNullable<ReturnType<typeof getToolCallFromAssistantEvent>>,
  ): void {
    if (startedToolCalls.has(toolCall.id)) {
      return
    }

    const toolInput = toJsonValue(toolCall.arguments)
    startedToolCalls.add(toolCall.id)
    toolCallInputs.set(toolCall.id, toolInput)
    emitEvent(input.onEvent, {
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
      model: input.model,
    })
  }

  return (event) => {
    if (event.type === 'agent_start') {
      emitEvent(input.onEvent, {
        type: 'agent_start',
        runId,
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'message_start' && event.message.role === 'assistant') {
      currentMessageId = createStreamingMessageId()
      emitEvent(input.onEvent, {
        type: 'message_start',
        messageId: currentMessageId,
        role: 'assistant',
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'message_update') {
      if (!currentMessageId) {
        currentMessageId = createStreamingMessageId()
        emitEvent(input.onEvent, {
          type: 'message_start',
          messageId: currentMessageId,
          role: 'assistant',
          timestamp: Date.now(),
          model: input.model,
        })
      }

      const assistantEvent = event.assistantMessageEvent
      if (assistantEvent.type === 'text_delta') {
        emitEvent(input.onEvent, {
          type: 'message_update',
          messageId: currentMessageId,
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: assistantEvent.contentIndex,
            delta: assistantEvent.delta,
          },
          timestamp: Date.now(),
          model: input.model,
        })
        return
      }

      if (assistantEvent.type === 'thinking_start') {
        const stepId = `${currentMessageId}:thinking:${String(assistantEvent.contentIndex)}`
        thinkingSteps.add(stepId)
        emitEvent(input.onEvent, {
          type: 'message_update',
          messageId: currentMessageId,
          role: 'assistant',
          assistantMessageEvent: {
            type: 'thinking_start',
            contentIndex: assistantEvent.contentIndex,
          },
          timestamp: Date.now(),
          model: input.model,
        })
        return
      }

      if (assistantEvent.type === 'thinking_delta') {
        const stepId = `${currentMessageId}:thinking:${String(assistantEvent.contentIndex)}`
        if (!thinkingSteps.has(stepId)) {
          thinkingSteps.add(stepId)
          emitEvent(input.onEvent, {
            type: 'message_update',
            messageId: currentMessageId,
            role: 'assistant',
            assistantMessageEvent: {
              type: 'thinking_start',
              contentIndex: assistantEvent.contentIndex,
            },
            timestamp: Date.now(),
            model: input.model,
          })
        }
        emitEvent(input.onEvent, {
          type: 'message_update',
          messageId: currentMessageId,
          role: 'assistant',
          assistantMessageEvent: {
            type: 'thinking_delta',
            contentIndex: assistantEvent.contentIndex,
            delta: assistantEvent.delta,
          },
          timestamp: Date.now(),
          model: input.model,
        })
        return
      }

      if (assistantEvent.type === 'toolcall_start') {
        const toolCall = getToolCallFromAssistantEvent(event)
        if (toolCall) {
          emitToolCallStart(currentMessageId, assistantEvent.contentIndex, toolCall)
        }
        return
      }

      if (assistantEvent.type === 'toolcall_delta') {
        const toolCall = getToolCallFromAssistantEvent(event)
        if (toolCall) {
          emitToolCallStart(currentMessageId, assistantEvent.contentIndex, toolCall)
          const toolInput = toJsonValue(toolCall.arguments)
          toolCallInputs.set(toolCall.id, toolInput)
          emitEvent(input.onEvent, {
            type: 'message_update',
            messageId: currentMessageId,
            role: 'assistant',
            assistantMessageEvent: {
              type: 'toolcall_delta',
              contentIndex: assistantEvent.contentIndex,
              toolCallId: toolCall.id,
              delta: assistantEvent.delta,
              input: toolInput,
            },
            timestamp: Date.now(),
            model: input.model,
          })
        }
        return
      }

      if (assistantEvent.type === 'toolcall_end') {
        const toolCall = getToolCallFromAssistantEvent(event)
        if (toolCall) {
          emitToolCallStart(currentMessageId, assistantEvent.contentIndex, toolCall)
          const toolInput = toJsonValue(toolCall.arguments)
          toolCallInputs.set(toolCall.id, toolInput)
          emitEvent(input.onEvent, {
            type: 'message_update',
            messageId: currentMessageId,
            role: 'assistant',
            assistantMessageEvent: {
              type: 'toolcall_end',
              contentIndex: assistantEvent.contentIndex,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolInput,
            },
            timestamp: Date.now(),
            model: input.model,
          })
        }
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      const toolInput = toJsonValue(event.args)
      toolCallInputs.set(event.toolCallId, toolInput)
      emitEvent(input.onEvent, {
        type: 'tool_execution_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toolInput,
        parentMessageId: currentMessageId ?? undefined,
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'tool_execution_update') {
      const toolInput = toJsonValue(event.args)
      toolCallInputs.set(event.toolCallId, toolInput)
      emitEvent(input.onEvent, {
        type: 'tool_execution_update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toolInput,
        partialResult: toJsonValue(event.partialResult),
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'tool_execution_end') {
      const toolInput = toolCallInputs.get(event.toolCallId)
      emitEvent(input.onEvent, {
        type: 'tool_execution_end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toolInput,
        result: toJsonValue(event.result),
        isError: event.isError,
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'message_end' && currentMessageId && event.message.role === 'assistant') {
      emitEvent(input.onEvent, {
        type: 'message_end',
        messageId: currentMessageId,
        role: 'assistant',
        timestamp: Date.now(),
        model: input.model,
      })
      currentMessageId = null
      return
    }

    if (event.type === 'queue_update') {
      emitEvent(input.onEvent, {
        type: 'queue_update',
        steering: [...event.steering],
        followUp: [...event.followUp],
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'compaction_start') {
      emitEvent(input.onEvent, {
        type: 'compaction_start',
        reason: event.reason,
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'compaction_end') {
      emitEvent(input.onEvent, {
        type: 'compaction_end',
        reason: event.reason,
        result: toJsonValue(event.result ?? null),
        aborted: event.aborted,
        willRetry: event.willRetry,
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'auto_retry_start') {
      emitEvent(input.onEvent, {
        type: 'auto_retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'auto_retry_end') {
      emitEvent(input.onEvent, {
        type: 'auto_retry_end',
        success: event.success,
        attempt: event.attempt,
        ...(event.finalError ? { finalError: event.finalError } : {}),
        timestamp: Date.now(),
        model: input.model,
      })
      return
    }

    if (event.type === 'agent_end') {
      const reason = getAgentEndReason(event.messages)
      const error =
        reason === 'error' || reason === 'aborted' ? getAgentEndError(event.messages) : undefined
      emitEvent(input.onEvent, {
        type: 'agent_end',
        runId,
        reason,
        usage: getAgentEndUsage(event.messages),
        ...(error ? { error } : {}),
        timestamp: Date.now(),
        model: input.model,
      })
    }
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
