import { randomUUID } from 'node:crypto'
import type { AgentSendPayload, Message, PreparedAttachment } from '@shared/types/agent'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { chat, type ModelMessage, maxIterations, type StreamChunk } from '@tanstack/ai'
import { loadProjectConfig } from '../config/project-config'
import { createLogger } from '../logger'
import { runWithToolContext } from '../tools/define-tool'
import { getServerTools } from '../tools/registry'
import {
  getActiveAgentFeatures,
  getFeatureLifecycleHooks,
  getFeaturePromptFragments,
} from './feature-registry'
import {
  notifyRunComplete,
  notifyRunError,
  notifyRunStart,
  notifyStreamChunk,
  notifyToolCallEnd,
  notifyToolCallStart,
} from './lifecycle-hooks'
import { conversationToMessages, type SimpleChatMessage } from './message-mapper'
import { buildSystemPrompt } from './prompt-pipeline'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'
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

const logger = createLogger('agent')

const MAX_ITERATIONS = 25

export interface AgentRunParams {
  readonly conversation: Conversation
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly settings: Settings
  /** Forward raw StreamChunks to the renderer via IPC for the useChat adapter */
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
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

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  return error.message.trim().toLowerCase() === 'aborted'
}

function providerSupportsNativeAttachment(
  provider: Provider,
  attachment: PreparedAttachment,
): boolean {
  if (!attachment.source) return false

  if (attachment.kind === 'image') {
    return provider === 'openai' || provider === 'anthropic' || provider === 'gemini'
  }
  if (attachment.kind === 'pdf') {
    return provider === 'openai' || provider === 'anthropic' || provider === 'gemini'
  }

  return false
}

function buildUserChatContent(
  provider: Provider,
  payload: AgentSendPayload,
): string | ChatContentPart[] {
  const parts: ChatContentPart[] = []

  if (payload.text.trim()) {
    parts.push({ type: 'text', content: payload.text.trim() })
  }

  for (const attachment of payload.attachments) {
    if (providerSupportsNativeAttachment(provider, attachment) && attachment.source) {
      if (attachment.kind === 'image') {
        parts.push({
          type: 'image',
          source: attachment.source,
        })
      } else if (attachment.kind === 'pdf') {
        parts.push({
          type: 'document',
          source: attachment.source,
        })
      }
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
  const { conversation, payload, model, settings, onChunk, signal } = params
  const hasContinuationMessages = (payload.continuationMessages?.length ?? 0) > 0
  const projectPath = resolveAgentProjectPath(conversation.projectPath)
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
      signal,
      dynamicSkills: {
        loadedSkillIds: dynamicLoadedSkillIds,
        toggles: skillToggles,
      },
      dynamicAgents: {
        loadedScopeFiles: dynamicLoadedAgentsScopeFiles,
        loadedRequestedPaths: dynamicLoadedAgentsRequestedPaths,
      },
    },
    async () => {
      const stageDurationsMs: Record<string, number> = {}
      const collector = new StreamPartCollector()
      let runErrorNotified = false

      let context: AgentRunContext | null = null
      let hooks: AgentLifecycleHook[] = []
      let promptFragmentIds: readonly string[] = []

      try {
        const runId = randomUUID()

        const projectConfig = await withStageTiming(stageDurationsMs, 'project-config', () =>
          loadProjectConfig(projectPath),
        )

        const { provider, providerConfig, resolvedModel, qualityConfig } = await withStageTiming(
          stageDurationsMs,
          'provider-resolution',
          () => {
            const resolution = resolveProviderAndQuality(
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

        const features = getActiveAgentFeatures(runContext)
        hooks = getFeatureLifecycleHooks(runContext, features)

        await notifyRunStart(hooks, runContext)

        const { prompt: systemPrompt, fragmentIds } = await withStageTiming(
          stageDurationsMs,
          'prompt-composition',
          () => {
            const fragments = getFeaturePromptFragments(runContext, features)
            return buildSystemPrompt(runContext, fragments)
          },
        )
        promptFragmentIds = fragmentIds

        const tools = await withStageTiming(stageDurationsMs, 'tool-resolution', () =>
          getServerTools(runContext, features),
        )

        const adapter = provider.createAdapter(
          resolvedModel,
          providerConfig.apiKey ?? '',
          providerConfig.baseUrl,
        )

        const abortController = new AbortController()
        signal.addEventListener('abort', () => abortController.abort(), { once: true })

        const stream = await withStageTiming(stageDurationsMs, 'stream-setup', () => {
          const allMessages: ModelMessage[] | SimpleChatMessage[] = hasContinuationMessages
            ? [...(payload.continuationMessages ?? [])]
            : (() => {
                const existingMessages = conversationToMessages(conversation.messages)
                const newUserMessage: SimpleChatMessage = {
                  role: 'user',
                  content: buildUserChatContent(provider.id, payload),
                }
                return [...existingMessages, newUserMessage]
              })()
          const samplingOptions = buildSamplingOptions(qualityConfig)

          return chat({
            adapter,
            messages: allMessages,
            systemPrompts: [systemPrompt],
            conversationId: String(conversation.id),
            tools,
            ...samplingOptions,
            maxTokens: qualityConfig.maxTokens,
            modelOptions: qualityConfig.modelOptions,
            agentLoopStrategy: maxIterations(MAX_ITERATIONS),
            abortController,
          })
        })

        let aborted = false
        await withStageTiming(stageDurationsMs, 'stream-processing', async () => {
          for await (const chunk of stream) {
            if (signal.aborted) {
              aborted = true
              break
            }

            onChunk(chunk)
            notifyStreamChunk(hooks, runContext, chunk)

            const collected = collector.handleChunk(chunk)
            if (collected.toolCallStart) {
              notifyToolCallStart(hooks, runContext, collected.toolCallStart)
            }
            if (collected.toolCallEnd) {
              notifyToolCallEnd(hooks, runContext, collected.toolCallEnd)
            }
            if (collected.runError) {
              runErrorNotified = true
              await notifyRunError(hooks, runContext, collected.runError)
            }
          }
        })
        if (aborted || signal.aborted) {
          throw new Error('aborted')
        }

        const finalParts = collector.finalizeParts()
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
