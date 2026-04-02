import { randomUUID } from 'node:crypto'
import {
  extractTextFromParts,
  type HydratedAgentSendPayload,
  hasToolCallNamed,
  type Message,
  type MessagePart,
} from '@shared/types/agent'
import { type SkipApprovalToken, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { classifyErrorMessage } from '@shared/types/errors'
import type { SupportedModelId } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { loadProjectConfig } from '../config/project-config'
import { approvalTraceEnabled } from '../env'
import { AgentCancelledError } from '../errors'
import { createLogger } from '../logger'
import { wrapChatAdapter } from '../ports/chat-adapter-type'
import type { ChatStreamOptions } from '../ports/chat-service'
import { StandardsService } from '../ports/standards-service'
import { bindToolContextToTools } from '../tools/define-tool'
import {
  describeContinuationMessageFormat,
  enrichContinuationMessages,
  extractDeniedApprovalSnapshot,
  parseToolArgumentsObject,
  restoreContinuationToolArgs,
} from './agent-continuation'
import {
  isAgentCancelledCause,
  isRetryableStallReason,
  toEffectError,
  withAbortBridge,
  withStageTimingEffect,
} from './agent-effect-utils'
import { buildFreshChatMessages } from './agent-message-builder'
import { normalizeContinuationAsUIMessages } from './continuation-normalizer'
import { notifyRunComplete, notifyRunError, notifyRunStart } from './lifecycle-hooks'
import { buildAgentPrompt } from './prompt-builder'
import type { AgentLifecycleHook, AgentRunContext, SubAgentRunContext } from './runtime-types'
import {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  isResolutionError,
  makeMessage,
  resolveAgentProjectPath,
  resolveProviderAndQuality,
} from './shared'
import { StreamPartCollector } from './stream-part-collector'
import { type ProviderErrorInfo, processAgentStreamEffect } from './stream-processor'
import { resolveToolContextAttachments } from './tool-context-attachments'

const logger = createLogger('agent')
const approvalTraceLogger = createLogger('approval-trace')

const MAX_ITERATIONS = 25
const MAX_STALL_RETRIES = 2
const STALL_RETRY_DELAY_MS = 2000
const MAX_PROVIDER_RETRIES = 2
const PROVIDER_RETRY_BASE_DELAY_MS = 1000
const INCOMPLETE_TOOL_ARGS_STALL_ERROR =
  'Agent stream stalled while generating tool arguments. Please try again.'
const INCOMPLETE_TOOL_CALL_STALL_ERROR =
  'Agent stream stalled before tool execution completed. Please try again.'

export interface AgentRunParams {
  readonly conversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly model: SupportedModelId
  readonly settings: Settings
  /** Forward raw AgentStreamChunks to the renderer via IPC for the useChat adapter */
  readonly onChunk: (chunk: AgentStreamChunk) => void
  readonly signal: AbortSignal
  /** Domain-owned chat stream factory — replaces direct `chat()` from `@tanstack/ai`. */
  readonly chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
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
  /**
   * Called when a user-blocking tool (proposePlan / askUser) is about to
   * block for user input. Receives the collector's current snapshot of
   * message parts. The callback must persist the conversation state so
   * that an app crash during the wait does not lose messages.
   */
  readonly onCheckpointNeeded?: (parts: readonly MessagePart[]) => Promise<void>
}

export interface AgentRunResult {
  readonly newMessages: readonly Message[]
  readonly finalMessage: Message
}

export function runAgentEffect(
  params: AgentRunParams,
): Effect.Effect<AgentRunResult, Error, StandardsService> {
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
    chatStream: params.chatStream,
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

    const standardsService = yield* StandardsService
    const standards = yield* withStageTimingEffect(
      stageDurationsMs,
      'standards-resolution',
      standardsService.loadContext({
        projectPath,
        userText: payload.text,
        settings,
        attachments: payload.attachments,
      }),
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
      planModeRequested: payload.planModeRequested ?? conversation.planModeActive,
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

    const adapter = wrapChatAdapter(
      resolution.provider.createAdapter(
        resolution.resolvedModel,
        resolution.providerConfig.apiKey,
        resolution.providerConfig.baseUrl,
        resolution.providerConfig.authMethod,
      ),
    )
    const allMessages: readonly unknown[] = hasContinuationMessages
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
      readonly providerError?: ProviderErrorInfo
    } | null = null
    let stallAttempt = 0
    let providerRetryAttempt = 0

    // Suppress duplicate RUN_STARTED chunks from stall retries.
    // Each fresh chatStream() emits RUN_STARTED, but the renderer treats
    // it as a run reset — causing accumulated streaming content to
    // be wiped and reloaded from disk at once when the run finishes.
    let runStartedForwarded = false
    const deduplicatedOnChunk = (chunk: AgentStreamChunk): void => {
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
              return params.chatStream({
                adapter,
                messages: allMessages,
                systemPrompts: [built.systemPrompt],
                conversationId: String(conversation.id),
                tools,
                maxIterations: params.maxTurns ?? MAX_ITERATIONS,
                abortController,
                samplingOptions: {
                  ...samplingOptions,
                  maxTokens: resolution.qualityConfig.maxTokens,
                  modelOptions: resolution.qualityConfig.modelOptions,
                },
              })
            }),
          )

          const streamProcessingEffect = processAgentStreamEffect({
            stream,
            collector,
            onChunk: deduplicatedOnChunk,
            signal,
            hooks,
            runContext,
            approvalTraceEnabled,
            stallTimeoutMs: params.stallTimeoutMs,
            onCheckpointNeeded: params.onCheckpointNeeded
              ? (() => {
                  const checkpoint = params.onCheckpointNeeded
                  return () => checkpoint(collector.snapshotParts())
                })()
              : undefined,
          })

          // Catch thrown provider errors (non-OAuth adapters throw instead of
          // yielding RUN_ERROR chunks) and surface them as providerError so
          // the retry branch can classify and decide.
          // Only intercept errors that classify as a recognized provider error
          // code — truly unknown errors (programming bugs, type errors) must
          // propagate immediately to avoid masking them behind silent retries.
          const withProviderErrorCatch = streamProcessingEffect.pipe(
            Effect.catchAll((thrown) => {
              if (collector.hasUnresolvedToolResults()) {
                return Effect.fail(thrown)
              }
              const message = thrown instanceof Error ? thrown.message : String(thrown)
              const classified = classifyErrorMessage(message)
              if (classified.code === 'unknown') {
                return Effect.fail(thrown)
              }
              return Effect.succeed({
                aborted: false,
                runErrorNotified: false,
                timedOut: false,
                stallReason: null,
                providerError: { message },
              })
            }),
          )

          return yield* withStageTimingEffect(
            stageDurationsMs,
            'stream-processing',
            withProviderErrorCatch,
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

      // Provider error — classify and decide whether to retry or surface.
      if (streamResult.providerError) {
        const classified = classifyErrorMessage(streamResult.providerError.message)

        if (!classified.retryable || providerRetryAttempt >= MAX_PROVIDER_RETRIES) {
          if (providerRetryAttempt >= MAX_PROVIDER_RETRIES) {
            logger.warn('Provider error retry budget exhausted', {
              conversationId: conversation.id,
              retries: providerRetryAttempt,
              error: streamResult.providerError.message,
            })
          }
          return yield* Effect.fail(new Error(streamResult.providerError.message))
        }

        if (providerRetryAttempt === 0) {
          logger.warn('Transient provider error, retrying with backoff', {
            conversationId: conversation.id,
            maxRetries: MAX_PROVIDER_RETRIES,
            errorCode: classified.code,
            error: streamResult.providerError.message,
          })
        }

        providerRetryAttempt += 1
        const backoffMs = PROVIDER_RETRY_BASE_DELAY_MS * 2 ** (providerRetryAttempt - 1)
        yield* Effect.sleep(Duration.millis(backoffMs))

        if (signal.aborted) {
          return yield* Effect.fail(new AgentCancelledError({}))
        }
        continue
      }

      break
    }

    if (!streamResult) {
      return yield* Effect.fail(new Error('Agent stream did not start'))
    }

    // Plan mode enforcement: if planModeRequested but the model never called
    // proposePlan, extract its research output and re-run with a forced
    // proposePlan instruction. This handles models that ignore the system
    // prompt and answer directly despite plan mode being active.
    // Uses snapshotParts() (non-destructive) to check without consuming the
    // collector — finalizeParts() is only called once, after this block.
    const planModeActive = payload.planModeRequested ?? conversation.planModeActive
    if (planModeActive && !signal.aborted) {
      const snapshotParts = collector.snapshotParts()

      if (!hasToolCallNamed(snapshotParts, 'proposePlan')) {
        const researchText = extractTextFromParts(snapshotParts)

        if (researchText.trim()) {
          logger.info('Plan mode enforcement: model skipped proposePlan, injecting re-run', {
            conversationId: conversation.id,
            researchLength: researchText.length,
          })

          // Build a new message set: original messages + the research as an
          // assistant turn + a system nudge as a user turn asking for the plan.
          const planNudgeMessages: typeof allMessages = [
            ...allMessages,
            { role: 'assistant' as const, content: researchText },
            {
              role: 'user' as const,
              content:
                'You gathered good research above. Now call the proposePlan tool with a structured plan based on your findings. Do NOT repeat the research — just call proposePlan.',
            },
          ]

          // Re-run with nudge — single pass, no retry loop
          collector = new StreamPartCollector()
          params.onCollectorCreated?.(collector)

          const nudgeResult = yield* withAbortBridge(signal, (abortController) =>
            Effect.gen(function* () {
              const nudgeStream = yield* Effect.sync(() =>
                params.chatStream({
                  adapter,
                  messages: planNudgeMessages,
                  systemPrompts: [built.systemPrompt],
                  conversationId: String(conversation.id),
                  tools,
                  maxIterations: params.maxTurns ?? MAX_ITERATIONS,
                  abortController,
                  samplingOptions: {
                    ...samplingOptions,
                    maxTokens: resolution.qualityConfig.maxTokens,
                    modelOptions: resolution.qualityConfig.modelOptions,
                  },
                }),
              )

              return yield* processAgentStreamEffect({
                stream: nudgeStream,
                collector,
                onChunk: deduplicatedOnChunk,
                signal,
                hooks,
                runContext,
                approvalTraceEnabled,
                stallTimeoutMs: params.stallTimeoutMs,
              })
            }),
          )

          if (nudgeResult.aborted || signal.aborted) {
            return yield* Effect.fail(new AgentCancelledError({}))
          }

          // Check if the nudge re-run produced proposePlan
          const nudgeParts = collector.snapshotParts()
          if (!hasToolCallNamed(nudgeParts, 'proposePlan')) {
            logger.warn('Plan mode enforcement: nudge re-run also skipped proposePlan', {
              conversationId: conversation.id,
            })
          }

          streamResult = nudgeResult
        }
      }
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
  // runAgentEffect requires StandardsService in its context.
  // Use Effect.runPromise with a local layer instead of the managed runtime
  // to avoid nested runtime calls — callers (executeAgentRun, waggle-coordinator,
  // sub-agent-runner) already run inside the managed runtime.
  const { FilesystemStandardsLive } = await import('../adapters/standards-adapter')
  return Effect.runPromise(runAgentEffect(params).pipe(Effect.provide(FilesystemStandardsLive)))
}
