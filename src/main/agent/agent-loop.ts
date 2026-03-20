import { randomUUID } from 'node:crypto'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { HydratedAgentSendPayload, Message, MessagePart } from '@shared/types/agent'
import { type SkipApprovalToken, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { JsonObject } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { choose } from '@shared/utils/decision'
import { parseJsonSafe } from '@shared/utils/parse-json'
import {
  isDeniedApprovalPayload,
  normalizeToolResultPayload,
} from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'
import {
  chat,
  type ModelMessage,
  maxIterations,
  type StreamChunk,
  type UIMessage,
} from '@tanstack/ai'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { loadProjectConfig } from '../config/project-config'
import { approvalTraceEnabled } from '../env'
import { AgentCancelledError } from '../errors'
import { createLogger } from '../logger'
import type { ProviderDefinition } from '../providers/provider-definition'
import { bindToolContextToTools } from '../tools/define-tool'
import {
  type ContinuationMessage,
  normalizeContinuationAsUIMessages,
} from './continuation-normalizer'
import { notifyRunComplete, notifyRunError, notifyRunStart } from './lifecycle-hooks'
import { conversationToMessages } from './message-mapper'
import { buildAgentPrompt } from './prompt-builder'
import type { AgentLifecycleHook, AgentRunContext, SubAgentRunContext } from './runtime-types'
import {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  type ChatContentPart,
  isResolutionError,
  makeMessage,
  resolveAgentProjectPath,
  resolveProviderAndQuality,
} from './shared'
import { loadAgentStandardsContext } from './standards-context'
import { StreamPartCollector } from './stream-part-collector'
import { processAgentStreamEffect } from './stream-processor'
import { resolveToolContextAttachments } from './tool-context-attachments'

const logger = createLogger('agent')
const approvalTraceLogger = createLogger('approval-trace')

const MAX_ITERATIONS = 25
const MAX_STALL_RETRIES = 2
const STALL_RETRY_DELAY_MS = 2000
const INCOMPLETE_TOOL_ARGS_STALL_ERROR =
  'Agent stream stalled while generating tool arguments. Please try again.'
const INCOMPLETE_TOOL_CALL_STALL_ERROR =
  'Agent stream stalled before tool execution completed. Please try again.'

export interface AgentRunParams {
  readonly conversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly model: SupportedModelId
  readonly settings: Settings
  /** Forward raw StreamChunks to the renderer via IPC for the useChat adapter */
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
  /**
   * When set with a branded token, tools that normally require approval
   * are auto-executed. Only the waggle coordinator should create this token.
   * Using a branded type prevents accidental `skipApproval: true`.
   */
  readonly skipApproval?: SkipApprovalToken
  readonly onCollectorCreated?: (collector: StreamPartCollector) => void
  readonly subAgentContext?: SubAgentRunContext
  /** Waggle file cache context — shared across agents in a waggle session. */
  readonly waggleContext?: {
    readonly agentLabel: string
    readonly fileCache: import('./waggle-file-cache').WaggleFileCache
  }
  /** Maximum agent loop iterations. Defaults to MAX_ITERATIONS (25). */
  readonly maxTurns?: number
  /** Override stream stall timeout (ms). Waggle turns use a longer timeout
   *  because orchestrate tools may run for several minutes. */
  readonly stallTimeoutMs?: number
}

export interface AgentRunResult {
  readonly newMessages: readonly Message[]
  readonly finalMessage: Message
}

interface DeniedApprovalSnapshot {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: string
  readonly message: string
}

function isRetryableStallReason(
  stallReason: 'stream-stall' | 'incomplete-tool-args' | 'awaiting-tool-result' | null,
): stallReason is 'stream-stall' | 'incomplete-tool-args' {
  return stallReason === 'stream-stall' || stallReason === 'incomplete-tool-args'
}

type UiToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

function isUiContinuationMessage(message: ContinuationMessage): message is UIMessage {
  return 'parts' in message
}

function parseToolArgumentsObject(args: string): {
  readonly parsed: JsonObject
  readonly valid: boolean
} {
  const result = parseJsonSafe(args, jsonObjectSchema)
  if (result.success) {
    return { parsed: result.data, valid: true }
  }

  return { parsed: {}, valid: false }
}

function hasNonEmptyToolArgs(args: Readonly<JsonObject>): boolean {
  return Object.keys(args).length > 0
}

function buildPersistedToolArgsMap(
  serverMessages: readonly Message[],
): Map<string, Readonly<JsonObject>> {
  const persistedToolArgs = new Map<string, Readonly<JsonObject>>()

  for (const message of serverMessages) {
    if (message.role !== 'assistant') {
      continue
    }

    for (const part of message.parts) {
      if (part.type === 'tool-call' && hasNonEmptyToolArgs(part.toolCall.args)) {
        persistedToolArgs.set(String(part.toolCall.id), part.toolCall.args)
        continue
      }

      if (part.type === 'tool-result' && hasNonEmptyToolArgs(part.toolResult.args)) {
        persistedToolArgs.set(String(part.toolResult.id), part.toolResult.args)
      }
    }
  }

  return persistedToolArgs
}

function restoreContinuationToolArgs(
  finalParts: readonly MessagePart[],
  serverMessages: readonly Message[],
): MessagePart[] {
  const persistedToolArgs = buildPersistedToolArgsMap(serverMessages)
  let didChange = false

  const restoredParts = finalParts.map((part) => {
    if (part.type === 'tool-call') {
      if (hasNonEmptyToolArgs(part.toolCall.args)) {
        return part
      }

      const restoredArgs = persistedToolArgs.get(String(part.toolCall.id))
      if (!restoredArgs) {
        return part
      }

      didChange = true
      return {
        ...part,
        toolCall: {
          ...part.toolCall,
          args: restoredArgs,
        },
      }
    }

    if (part.type === 'tool-result') {
      if (hasNonEmptyToolArgs(part.toolResult.args)) {
        return part
      }

      const restoredArgs = persistedToolArgs.get(String(part.toolResult.id))
      if (!restoredArgs) {
        return part
      }

      didChange = true
      return {
        ...part,
        toolResult: {
          ...part.toolResult,
          args: restoredArgs,
        },
      }
    }

    return part
  })

  return didChange ? restoredParts : [...finalParts]
}

function describeContinuationMessageFormat(
  continuationMessages: readonly ContinuationMessage[],
): 'ui' | 'model' | 'mixed' | 'none' {
  if (continuationMessages.length === 0) {
    return 'none'
  }

  let sawUiMessage = false
  let sawModelMessage = false

  for (const message of continuationMessages) {
    if ('parts' in message) {
      sawUiMessage = true
    } else {
      sawModelMessage = true
    }
  }

  if (sawUiMessage && sawModelMessage) {
    return 'mixed'
  }

  return sawUiMessage ? 'ui' : 'model'
}

function extractDeniedApprovalSnapshot(
  continuationMessages: readonly ContinuationMessage[],
): DeniedApprovalSnapshot | null {
  const completedToolCallIds = new Set<string>()

  for (const message of continuationMessages) {
    if (!isUiContinuationMessage(message)) {
      continue
    }

    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        completedToolCallIds.add(part.toolCallId)
      }
    }
  }

  for (let messageIndex = continuationMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = continuationMessages[messageIndex]
    if (!message || !isUiContinuationMessage(message) || message.role !== 'assistant') {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part || part.type !== 'tool-call') {
        continue
      }

      if (completedToolCallIds.has(part.id)) {
        continue
      }

      const deniedPayload = normalizeToolResultPayload(part.output)
      const deniedByOutput = isDeniedApprovalPayload(deniedPayload)
      const deniedByApproval = part.approval?.approved === false

      if (!deniedByOutput && !deniedByApproval) {
        continue
      }

      const messageText =
        deniedByOutput && isRecord(deniedPayload)
          ? (() => {
              const candidateMessage = deniedPayload.message
              return typeof candidateMessage === 'string'
                ? candidateMessage
                : 'User declined tool execution'
            })()
          : 'User declined tool execution'

      return {
        toolCallId: part.id,
        toolName: part.name,
        args: part.arguments,
        message: messageText,
      }
    }
  }

  return null
}

function parseToolOutput(result: string): unknown {
  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}

function patchUiToolCallPart(
  part: UiToolCallPart,
  updates: {
    readonly arguments?: string
    readonly output?: unknown
  },
): UiToolCallPart {
  const nextArguments = updates.arguments ?? part.arguments
  const hasOutput = Object.hasOwn(updates, 'output')

  return {
    ...part,
    arguments: nextArguments,
    ...(hasOutput ? { output: updates.output } : {}),
  }
}

function withStageTimingEffect<T, E, R>(
  stageDurationsMs: Record<string, number>,
  stageName: string,
  effect: Effect.Effect<T, E, R>,
): Effect.Effect<T, E, R> {
  const start = Date.now()
  return effect.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        stageDurationsMs[stageName] = Date.now() - start
      }),
    ),
  )
}

/**
 * Enrich normalized continuation UIMessages with args/output from the server's
 * persisted conversation history, and inject synthetic output for approved-but-
 * never-executed tools in non-last assistant messages.
 */
function enrichContinuationMessages(
  normalized: readonly ContinuationMessage[],
  serverMessages: readonly Message[],
): ContinuationMessage[] {
  // Build lookup maps from server-side persisted messages
  const toolArgsMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  for (const msg of serverMessages) {
    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type === 'tool-call') {
          const argsStr = JSON.stringify(part.toolCall.args)
          // Only store non-empty args — later messages from re-executions
          // may have empty args (no TOOL_CALL_ARGS chunks for continuation
          // tool re-runs), and we don't want them overwriting correct args.
          if (Object.keys(part.toolCall.args).length > 0) {
            toolArgsMap.set(String(part.toolCall.id), argsStr)
          }
        }
        if (part.type === 'tool-result') {
          toolResultMap.set(String(part.toolResult.id), part.toolResult.result)
        }
      }
    }
  }

  // Find the last assistant message index for synthetic output logic
  let lastAssistantIdx = -1
  for (let mi = normalized.length - 1; mi >= 0; mi--) {
    const m = normalized[mi]
    if (!m) {
      continue
    }
    if (m.role === 'assistant') {
      lastAssistantIdx = mi
      break
    }
  }

  return normalized.map((message, messageIndex) => {
    if (!isUiContinuationMessage(message) || message.role !== 'assistant') {
      return message
    }

    const parts = message.parts.map((part) => {
      if (part.type !== 'tool-call') {
        return part
      }

      const patchedArguments = toolArgsMap.get(part.id)
      const persistedResult = toolResultMap.get(part.id)
      const restoredOutput =
        part.output !== undefined
          ? part.output
          : persistedResult !== undefined
            ? parseToolOutput(persistedResult)
            : undefined
      const shouldSynthesizeSkippedOutput =
        messageIndex !== lastAssistantIdx &&
        restoredOutput === undefined &&
        part.approval?.approved === true

      return patchUiToolCallPart(part, {
        ...(patchedArguments !== undefined ? { arguments: patchedArguments } : {}),
        ...(restoredOutput !== undefined
          ? { output: restoredOutput }
          : shouldSynthesizeSkippedOutput
            ? { output: 'Tool execution was skipped because a new message was sent.' }
            : {}),
      })
    })

    return {
      ...message,
      parts,
    }
  })
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  return error.message.trim().toLowerCase() === 'aborted'
}

function buildUserChatContent(
  provider: ProviderDefinition,
  payload: HydratedAgentSendPayload,
): string | ChatContentPart[] {
  const parts: ChatContentPart[] = []

  if (payload.text.trim()) {
    parts.push({ type: 'text', content: payload.text.trim() })
  }

  for (const attachment of payload.attachments) {
    if (attachment.source && provider.supportsAttachment(attachment.kind)) {
      const source = attachment.source
      choose(attachment.kind)
        .case('image', () => {
          parts.push({
            type: 'image',
            source,
          })
        })
        .case('pdf', () => {
          parts.push({
            type: 'document',
            source,
          })
        })
        .catchAll(() => undefined)
    }

    const extracted = attachment.extractedText.trim()
    const summary = extracted
      ? `[Attachment: ${attachment.name}]\n${extracted}`
      : `[Attachment: ${attachment.name}] (no extractable text)`
    parts.push({ type: 'text', content: summary })
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].content
  }
  return parts
}

function buildFreshChatMessages(
  conversation: Conversation,
  provider: ProviderDefinition,
  payload: HydratedAgentSendPayload,
): ModelMessage[] {
  return [
    ...conversationToMessages(conversation.messages),
    {
      role: 'user',
      content: buildUserChatContent(provider, payload),
    },
  ]
}

function isAgentCancelledCause(error: unknown): boolean {
  return error instanceof AgentCancelledError || isAbortError(error)
}

function toEffectError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function withAbortBridge<A, E, R>(
  signal: AbortSignal,
  use: (abortController: AbortController) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const abortController = new AbortController()
      const onAbort = (): void => {
        abortController.abort()
      }

      signal.addEventListener('abort', onAbort, { once: true })
      return { abortController, onAbort }
    }),
    (state) => use(state.abortController),
    ({ abortController, onAbort }) =>
      Effect.sync(() => {
        signal.removeEventListener('abort', onAbort)
        abortController.abort()
      }),
  )
}

export function runAgentEffect(params: AgentRunParams): Effect.Effect<AgentRunResult, Error> {
  const { conversation, payload, model, settings, onChunk, signal, skipApproval } = params
  const hasContinuationMessages = (payload.continuationMessages?.length ?? 0) > 0
  const continuationMessageFormat = describeContinuationMessageFormat(
    payload.continuationMessages ?? [],
  )
  const projectPath = resolveAgentProjectPath(conversation.projectPath)
  const toolContextAttachments = resolveToolContextAttachments(conversation, payload)
  const dynamicLoadedSkillIds = new Set<string>()
  const dynamicLoadedAgentsScopeFiles = new Set<string>()
  const dynamicLoadedAgentsRequestedPaths = new Set<string>()
  const skillToggles = conversation.projectPath
    ? (settings.skillTogglesByProject[conversation.projectPath] ?? {})
    : {}
  const toolContext = {
    conversationId: conversation.id,
    projectPath,
    attachments: toolContextAttachments,
    signal,
    dynamicSkills: {
      loadedSkillIds: dynamicLoadedSkillIds,
      toggles: skillToggles,
    },
    dynamicAgents: {
      loadedScopeFiles: dynamicLoadedAgentsScopeFiles,
      loadedRequestedPaths: dynamicLoadedAgentsRequestedPaths,
    },
    ...(params.waggleContext
      ? {
          waggle: {
            agentLabel: params.waggleContext.agentLabel,
            fileCache: params.waggleContext.fileCache,
          },
        }
      : {}),
    ...(params.subAgentContext
      ? {
          subAgentContext: {
            agentId: params.subAgentContext.agentId,
            agentName: params.subAgentContext.agentName,
            teamId: params.subAgentContext.teamId,
            permissionMode: params.subAgentContext.permissionMode,
            depth: params.subAgentContext.depth,
          },
        }
      : {}),
  }

  const stageDurationsMs: Record<string, number> = {}
  let context: AgentRunContext | null = null
  let hooks: readonly AgentLifecycleHook[] = []
  let promptFragmentIds: readonly string[] = []
  let runErrorNotified = false

  const program = Effect.gen(function* () {
    const runId = randomUUID()

    if (approvalTraceEnabled && hasContinuationMessages) {
      approvalTraceLogger.info('continuation-run-start', {
        runId,
        conversationId: conversation.id,
        continuationMessageCount: payload.continuationMessages?.length ?? 0,
        continuationMessageFormat,
      })
    }

    const projectConfig = yield* withStageTimingEffect(
      stageDurationsMs,
      'project-config',
      Effect.tryPromise(() => loadProjectConfig(projectPath)),
    )

    const resolution = yield* withStageTimingEffect(
      stageDurationsMs,
      'provider-resolution',
      Effect.tryPromise(() =>
        resolveProviderAndQuality(
          model,
          payload.qualityPreset,
          settings.providers,
          projectConfig.quality,
        ),
      ),
    )

    if (isResolutionError(resolution)) {
      return yield* Effect.fail(new Error(resolution.reason))
    }

    const standards = yield* withStageTimingEffect(
      stageDurationsMs,
      'standards-resolution',
      Effect.tryPromise(() =>
        loadAgentStandardsContext(
          conversation.projectPath,
          payload.text,
          settings,
          payload.attachments,
        ),
      ),
    )

    context = {
      runId,
      conversation,
      model: resolution.resolvedModel,
      settings,
      signal,
      projectPath,
      hasProject: !!conversation.projectPath,
      provider: resolution.provider,
      providerConfig: resolution.providerConfig,
      toolApprovals: projectConfig.approvals,
      planModeRequested: payload.planModeRequested,
      subAgentContext: params.subAgentContext,
      standards,
    }

    const runContext = context

    for (const warning of runContext.standards?.warnings ?? []) {
      logger.warn(warning)
    }

    const built = yield* withStageTimingEffect(
      stageDurationsMs,
      'prompt-composition',
      Effect.tryPromise(() => Promise.resolve(buildAgentPrompt(runContext, !!skipApproval))),
    )
    hooks = built.hooks
    promptFragmentIds = built.promptFragmentIds

    yield* Effect.tryPromise(() => Promise.resolve(notifyRunStart(hooks, runContext)))

    const adapter = resolution.provider.createAdapter(
      resolution.resolvedModel,
      resolution.providerConfig.apiKey,
      resolution.providerConfig.baseUrl,
      resolution.providerConfig.authMethod,
    )
    const allMessages = hasContinuationMessages
      ? enrichContinuationMessages(
          normalizeContinuationAsUIMessages(payload.continuationMessages ?? []),
          conversation.messages,
        )
      : buildFreshChatMessages(conversation, resolution.provider, payload)
    const tools = bindToolContextToTools(built.tools, toolContext)
    const samplingOptions = buildSamplingOptions(resolution.qualityConfig)
    const retryDriver = yield* Schedule.driver(
      Schedule.spaced(Duration.millis(STALL_RETRY_DELAY_MS)),
    )

    let collector = new StreamPartCollector()
    params.onCollectorCreated?.(collector)
    let streamResult: {
      readonly aborted: boolean
      readonly runErrorNotified: boolean
      readonly timedOut: boolean
      readonly stallReason: 'stream-stall' | 'incomplete-tool-args' | 'awaiting-tool-result' | null
    } | null = null
    let stallAttempt = 0

    // Suppress duplicate RUN_STARTED chunks from stall retries.
    // Each fresh chat() emits RUN_STARTED, but the renderer treats
    // it as a run reset — causing accumulated streaming content to
    // be wiped and reloaded from disk at once when the run finishes.
    let runStartedForwarded = false
    const deduplicatedOnChunk = (chunk: StreamChunk): void => {
      if (chunk.type === 'RUN_STARTED') {
        if (runStartedForwarded) return
        runStartedForwarded = true
      }
      onChunk(chunk)
    }

    while (true) {
      collector = new StreamPartCollector()
      params.onCollectorCreated?.(collector)

      streamResult = yield* withAbortBridge(signal, (abortController) =>
        Effect.gen(function* () {
          const stream = yield* withStageTimingEffect(
            stageDurationsMs,
            'stream-setup',
            Effect.sync(() => {
              return chat({
                adapter,
                messages: allMessages,
                systemPrompts: [built.systemPrompt],
                conversationId: String(conversation.id),
                tools,
                ...samplingOptions,
                maxTokens: resolution.qualityConfig.maxTokens,
                modelOptions: resolution.qualityConfig.modelOptions,
                agentLoopStrategy: maxIterations(params.maxTurns ?? MAX_ITERATIONS),
                abortController,
              })
            }),
          )

          return yield* withStageTimingEffect(
            stageDurationsMs,
            'stream-processing',
            processAgentStreamEffect({
              stream,
              collector,
              onChunk: deduplicatedOnChunk,
              signal,
              hooks,
              runContext,
              approvalTraceEnabled,
              stallTimeoutMs: params.stallTimeoutMs,
            }),
          )
        }),
      )
      runErrorNotified = streamResult.runErrorNotified

      if (streamResult.aborted || signal.aborted) {
        return yield* Effect.fail(new AgentCancelledError({}))
      }

      if (streamResult.timedOut && isRetryableStallReason(streamResult.stallReason)) {
        if (stallAttempt >= MAX_STALL_RETRIES) {
          logger.warn('Stream stalled after retry budget exhausted', {
            conversationId: conversation.id,
            retries: stallAttempt,
            stallReason: streamResult.stallReason,
          })
          if (streamResult.stallReason === 'incomplete-tool-args') {
            return yield* Effect.fail(new Error(INCOMPLETE_TOOL_ARGS_STALL_ERROR))
          }
          break
        }

        if (stallAttempt === 0) {
          logger.warn('Stream stalled, retrying with a fresh stream', {
            conversationId: conversation.id,
            maxRetries: MAX_STALL_RETRIES,
            stallReason: streamResult.stallReason,
          })
        }

        stallAttempt += 1
        yield* retryDriver.next(stallAttempt)

        if (signal.aborted) {
          return yield* Effect.fail(new AgentCancelledError({}))
        }
        continue
      }

      if (streamResult.timedOut && streamResult.stallReason === 'awaiting-tool-result') {
        logger.warn('Stream stalled waiting for tool execution result', {
          conversationId: conversation.id,
          pendingToolCalls: collector.getUnresolvedToolNames(),
        })
        return yield* Effect.fail(new Error(INCOMPLETE_TOOL_CALL_STALL_ERROR))
      }

      break
    }

    if (!streamResult) {
      return yield* Effect.fail(new Error('Agent stream did not start'))
    }

    let finalParts = collector.finalizeParts({ timedOut: streamResult.timedOut })
    if (hasContinuationMessages) {
      finalParts = restoreContinuationToolArgs(finalParts, conversation.messages)
    }
    const deniedApprovalSnapshot = hasContinuationMessages
      ? extractDeniedApprovalSnapshot(payload.continuationMessages ?? [])
      : null

    if (
      deniedApprovalSnapshot &&
      !finalParts.some(
        (part) =>
          part.type === 'tool-result' &&
          String(part.toolResult.id) === deniedApprovalSnapshot.toolCallId,
      )
    ) {
      const deniedArgs = parseToolArgumentsObject(deniedApprovalSnapshot.args)
      const hasToolCallPart = finalParts.some(
        (part) =>
          part.type === 'tool-call' &&
          String(part.toolCall.id) === deniedApprovalSnapshot.toolCallId,
      )

      if (!deniedArgs.valid) {
        if (approvalTraceEnabled) {
          approvalTraceLogger.warn('continuation-denial-invalid-args', {
            runId,
            conversationId: conversation.id,
            toolCallId: deniedApprovalSnapshot.toolCallId,
          })
        }
      }

      if (!hasToolCallPart) {
        finalParts.unshift({
          type: 'tool-call',
          toolCall: {
            id: ToolCallId(deniedApprovalSnapshot.toolCallId),
            name: deniedApprovalSnapshot.toolName,
            args: deniedArgs.parsed,
            state: 'approval-responded',
            approval: {
              id: `approval_${deniedApprovalSnapshot.toolCallId}`,
              needsApproval: true,
              approved: false,
            },
          },
        })
      }

      finalParts.unshift({
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(deniedApprovalSnapshot.toolCallId),
          name: deniedApprovalSnapshot.toolName,
          args: deniedArgs.parsed,
          result: JSON.stringify({
            approved: false,
            message: deniedApprovalSnapshot.message,
          }),
          isError: true,
          duration: 0,
        },
      })
      if (approvalTraceEnabled) {
        approvalTraceLogger.info('continuation-denial-synthesized', {
          runId,
          conversationId: conversation.id,
          toolCallId: deniedApprovalSnapshot.toolCallId,
          synthesizedToolCall: !hasToolCallPart,
        })
      }
    }

    if (approvalTraceEnabled && hasContinuationMessages) {
      approvalTraceLogger.info('continuation-run-finished', {
        runId,
        conversationId: conversation.id,
        timedOut: streamResult.timedOut,
        stallReason: streamResult.stallReason,
        finalPartTypes: finalParts.map((part) => part.type),
        toolResultCount: finalParts.filter((part) => part.type === 'tool-result').length,
      })
    }

    const stats = collector.getStats()
    yield* Effect.tryPromise(() =>
      Promise.resolve(
        notifyRunComplete(hooks, runContext, {
          promptFragmentIds,
          stageDurationsMs,
          toolCalls: stats.toolCalls,
          toolErrors: stats.toolErrors,
          selectedSkillIds: runContext.standards?.activation.selectedSkillIds ?? [],
          dynamicallyLoadedSkillIds: [...dynamicLoadedSkillIds],
          resolvedAgentsFiles: runContext.standards?.agentsResolvedFiles ?? [],
          dynamicallyLoadedAgentsScopes: [...dynamicLoadedAgentsScopeFiles],
          standardsWarnings: runContext.standards?.warnings ?? [],
        }),
      ),
    )

    const assistantMsg = makeMessage('assistant', finalParts, resolution.resolvedModel)
    const userMsg = hasContinuationMessages
      ? null
      : makeMessage('user', buildPersistedUserMessageParts(payload))
    const newMessages = userMsg ? [userMsg, assistantMsg] : [assistantMsg]

    return { newMessages, finalMessage: assistantMsg }
  })

  return program.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const aborted = signal.aborted || isAgentCancelledCause(error)
        const activeContext = context
        if (activeContext && !runErrorNotified && !aborted) {
          yield* Effect.tryPromise(() =>
            Promise.resolve(notifyRunError(hooks, activeContext, toEffectError(error))),
          )
        }

        return yield* Effect.fail(aborted ? new Error('aborted') : toEffectError(error))
      }),
    ),
  )
}

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return Effect.runPromise(runAgentEffect(params))
}
