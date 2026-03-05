import { randomUUID } from 'node:crypto'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { SkipApprovalToken } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { choose } from '@shared/utils/decision'
import { chat, type ModelMessage, maxIterations, type StreamChunk } from '@tanstack/ai'
import { loadProjectConfig } from '../config/project-config'
import { createLogger } from '../logger'
import type { ProviderDefinition } from '../providers/provider-definition'
import { runWithToolContext } from '../tools/define-tool'
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
import { processAgentStream } from './stream-processor'
import { resolveToolContextAttachments } from './tool-context-attachments'

const logger = createLogger('agent')

const MAX_ITERATIONS = 25
const MAX_STALL_RETRIES = 2
const STALL_RETRY_DELAY_MS = 2000

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
  /** Maximum agent loop iterations. Defaults to MAX_ITERATIONS (25). */
  readonly maxTurns?: number
}

export interface AgentRunResult {
  readonly newMessages: readonly Message[]
  readonly finalMessage: Message
}

async function withStageTiming<T>(
  stageDurationsMs: Record<string, number>,
  stageName: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    stageDurationsMs[stageName] = Date.now() - start
  }
}

/**
 * Enrich normalized continuation UIMessages with args/output from the server's
 * persisted conversation history, and inject synthetic output for approved-but-
 * never-executed tools in non-last assistant messages.
 */
function enrichContinuationMessages(
  normalized: ContinuationMessage[],
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
    if ('parts' in m && m.role === 'assistant') {
      lastAssistantIdx = mi
      break
    }
  }

  // Enrich tool-call parts and inject synthetic output in a single pass
  for (let mi = 0; mi < normalized.length; mi++) {
    const msg = normalized[mi]
    if (!msg) {
      continue
    }
    if (!('parts' in msg) || msg.role !== 'assistant') continue

    for (const part of msg.parts) {
      if (part.type !== 'tool-call') continue

      // Patch args from server history
      const patchedArgs = toolArgsMap.get(part.id)
      if (patchedArgs !== undefined) {
        ;(part as { arguments: string }).arguments = patchedArgs
      }

      // Patch output from server history
      const resultStr = toolResultMap.get(part.id)
      if (part.output === undefined && resultStr !== undefined) {
        try {
          ;(part as { output: unknown }).output = JSON.parse(resultStr)
        } catch {
          ;(part as { output: unknown }).output = resultStr
        }
      }

      // Synthetic output for approved-but-never-executed tools in
      // non-last assistant messages. Without output, the TextEngine
      // re-executes the tool and places its tool_result after the wrong
      // assistant message, violating Anthropic's tool_use/tool_result pairing.
      if (
        mi !== lastAssistantIdx &&
        part.output === undefined &&
        (part as { approval?: { approved?: boolean } }).approval?.approved === true
      ) {
        ;(part as { output: unknown }).output =
          'Tool execution was skipped because a new message was sent.'
      }
    }
  }

  return normalized
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

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const { conversation, payload, model, settings, onChunk, signal, skipApproval } = params
  const hasContinuationMessages = (payload.continuationMessages?.length ?? 0) > 0
  const projectPath = resolveAgentProjectPath(conversation.projectPath)
  const toolContextAttachments = resolveToolContextAttachments(conversation, payload)
  const dynamicLoadedSkillIds = new Set<string>()
  const dynamicLoadedAgentsScopeFiles = new Set<string>()
  const dynamicLoadedAgentsRequestedPaths = new Set<string>()
  const skillToggles = conversation.projectPath
    ? (settings.skillTogglesByProject[conversation.projectPath] ?? {})
    : {}

  return runWithToolContext(
    {
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
      subAgentContext: params.subAgentContext
        ? {
            agentId: params.subAgentContext.agentId,
            agentName: params.subAgentContext.agentName,
            teamId: params.subAgentContext.teamId,
            permissionMode: params.subAgentContext.permissionMode,
            depth: params.subAgentContext.depth,
          }
        : undefined,
    },
    async () => {
      const stageDurationsMs: Record<string, number> = {}
      let collector = new StreamPartCollector()
      params.onCollectorCreated?.(collector)

      let context: AgentRunContext | null = null
      let hooks: readonly AgentLifecycleHook[] = []
      let promptFragmentIds: readonly string[] = []
      let runErrorNotified = false

      try {
        const runId = randomUUID()

        // ── Stage 1: Project config ──
        const projectConfig = await withStageTiming(stageDurationsMs, 'project-config', () =>
          loadProjectConfig(projectPath),
        )

        // ── Stage 2: Provider + quality resolution ──
        const { provider, providerConfig, resolvedModel, qualityConfig } = await withStageTiming(
          stageDurationsMs,
          'provider-resolution',
          async () => {
            const resolution = await resolveProviderAndQuality(
              model,
              payload.qualityPreset,
              settings.providers,
              projectConfig.quality,
            )
            if (isResolutionError(resolution)) {
              throw new Error(resolution.reason)
            }
            return resolution
          },
        )

        // ── Stage 3: Build run context ──
        context = {
          runId,
          conversation,
          model: resolvedModel,
          settings,
          signal,
          projectPath,
          hasProject: !!conversation.projectPath,
          provider,
          providerConfig,
          toolApprovals: projectConfig.approvals,
          planModeRequested: payload.planModeRequested,
          subAgentContext: params.subAgentContext,
          standards: await withStageTiming(stageDurationsMs, 'standards-resolution', () =>
            loadAgentStandardsContext(
              conversation.projectPath,
              payload.text,
              settings,
              payload.attachments,
            ),
          ),
        }
        const runContext = context

        for (const warning of runContext.standards?.warnings ?? []) {
          logger.warn(warning)
        }

        // ── Stage 4: Prompt + tools ──
        const built = await withStageTiming(stageDurationsMs, 'prompt-composition', () =>
          buildAgentPrompt(runContext, !!skipApproval),
        )
        hooks = built.hooks
        promptFragmentIds = built.promptFragmentIds

        await notifyRunStart(hooks, runContext)

        // ── Stage 5: Create adapter + stream ──
        const adapter = provider.createAdapter(
          resolvedModel,
          providerConfig.apiKey,
          providerConfig.baseUrl,
          providerConfig.authMethod,
        )

        const abortController = new AbortController()
        signal.addEventListener('abort', () => abortController.abort(), { once: true })

        // For continuation (e.g. after tool approval), normalize but preserve
        // UIMessage format so the TextEngine can extract approval state from
        // parts via extractClientStateFromOriginalMessages(). The old path
        // (normalizeContinuationInput) converted to ModelMessages which strips
        // parts, causing the engine to re-request approval endlessly.
        const allMessages = hasContinuationMessages
          ? enrichContinuationMessages(
              normalizeContinuationAsUIMessages(payload.continuationMessages ?? []),
              conversation.messages,
            )
          : [
              ...conversationToMessages(conversation.messages),
              { role: 'user' as const, content: buildUserChatContent(provider, payload) },
            ]

        const samplingOptions = buildSamplingOptions(qualityConfig)

        function createStream(): ReturnType<typeof chat> {
          return chat({
            adapter,
            // Type assertion: continuation messages are UIMessages with parts
            // that the TextEngine handles via convertMessagesToModelMessages().
            messages: allMessages as ModelMessage[],
            systemPrompts: [built.systemPrompt],
            conversationId: String(conversation.id),
            tools: [...built.tools],
            ...samplingOptions,
            maxTokens: qualityConfig.maxTokens,
            modelOptions: qualityConfig.modelOptions,
            agentLoopStrategy: maxIterations(params.maxTurns ?? MAX_ITERATIONS),
            abortController,
          })
        }

        let stream = await withStageTiming(stageDurationsMs, 'stream-setup', createStream)

        // ── Stage 6: Process stream (with stall retry) ──
        let stallAttempt = 0
        let streamResult = await withStageTiming(stageDurationsMs, 'stream-processing', () =>
          processAgentStream({
            stream,
            collector,
            onChunk,
            signal,
            hooks,
            runContext,
          }),
        )
        runErrorNotified = streamResult.runErrorNotified

        while (
          streamResult.timedOut &&
          streamResult.stallReason === 'stream-stall' &&
          !signal.aborted &&
          stallAttempt < MAX_STALL_RETRIES
        ) {
          stallAttempt++
          logger.warn(`Stream stalled, retry ${stallAttempt}/${MAX_STALL_RETRIES}`, {
            conversationId: conversation.id,
          })

          await new Promise((resolve) => setTimeout(resolve, STALL_RETRY_DELAY_MS))
          if (signal.aborted) break

          // Fresh stream and collector for the retry attempt
          stream = await createStream()
          collector = new StreamPartCollector()
          params.onCollectorCreated?.(collector)

          streamResult = await processAgentStream({
            stream,
            collector,
            onChunk,
            signal,
            hooks,
            runContext,
          })
          runErrorNotified = streamResult.runErrorNotified
        }

        if (streamResult.timedOut && streamResult.stallReason === 'incomplete-tool-call') {
          logger.warn('Stream stalled with incomplete tool call; skipping retry', {
            conversationId: conversation.id,
          })
        }

        if (streamResult.aborted || signal.aborted) {
          throw new Error('aborted')
        }

        // ── Stage 7: Finalize ──
        const finalParts = collector.finalizeParts({ timedOut: streamResult.timedOut })

        const stats = collector.getStats()

        await notifyRunComplete(hooks, runContext, {
          promptFragmentIds,
          stageDurationsMs,
          toolCalls: stats.toolCalls,
          toolErrors: stats.toolErrors,
          selectedSkillIds: runContext.standards?.activation.selectedSkillIds ?? [],
          dynamicallyLoadedSkillIds: [...dynamicLoadedSkillIds],
          resolvedAgentsFiles: runContext.standards?.agentsResolvedFiles ?? [],
          dynamicallyLoadedAgentsScopes: [...dynamicLoadedAgentsScopeFiles],
          standardsWarnings: runContext.standards?.warnings ?? [],
        })

        const assistantMsg = makeMessage('assistant', finalParts, resolvedModel)
        const userMsg = hasContinuationMessages
          ? null
          : makeMessage('user', buildPersistedUserMessageParts(payload))
        const newMessages = userMsg ? [userMsg, assistantMsg] : [assistantMsg]

        return { newMessages, finalMessage: assistantMsg }
      } catch (error) {
        const aborted = signal.aborted || isAbortError(error)
        if (context && !runErrorNotified && !aborted) {
          const runError = error instanceof Error ? error : new Error(String(error))
          await notifyRunError(hooks, context, runError)
        }
        if (aborted) {
          throw new Error('aborted')
        }
        throw error
      }
    },
  )
}
