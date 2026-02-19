import { randomUUID } from 'node:crypto'
import type {
  AgentSendPayload,
  Message,
  MessagePart,
  PreparedAttachment,
} from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { chat, maxIterations, type StreamChunk } from '@tanstack/ai'
import { providerRegistry } from '../providers'
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
import { resolveQualityConfig } from './quality-config'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'
import { StreamPartCollector } from './stream-part-collector'

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

function makeMessage(
  role: 'user' | 'assistant',
  parts: MessagePart[],
  model?: SupportedModelId,
): Message {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model,
    createdAt: Date.now(),
  }
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
):
  | string
  | Array<
      | { type: 'text'; content: string }
      | { type: 'image'; source: { type: 'data'; value: string; mimeType: string } }
      | { type: 'document'; source: { type: 'data'; value: string; mimeType: string } }
    > {
  const parts: Array<
    | { type: 'text'; content: string }
    | { type: 'image'; source: { type: 'data'; value: string; mimeType: string } }
    | { type: 'document'; source: { type: 'data'; value: string; mimeType: string } }
  > = []

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

function buildPersistedUserMessageParts(payload: AgentSendPayload): MessagePart[] {
  const parts: MessagePart[] = []
  if (payload.text.trim()) {
    parts.push({ type: 'text', text: payload.text.trim() })
  }
  for (const attachment of payload.attachments) {
    const { source: _source, ...persisted } = attachment
    parts.push({
      type: 'attachment',
      attachment: persisted,
    })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const { conversation, payload, model, settings, onChunk, signal } = params

  return runWithToolContext(
    {
      conversationId: conversation.id,
      projectPath: conversation.projectPath ?? process.cwd(),
      executionMode: settings.executionMode,
      signal,
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

        const { provider, providerConfig, resolvedModel, qualityConfig } = await withStageTiming(
          stageDurationsMs,
          'provider-resolution',
          async () => {
            const selectedProvider = providerRegistry.getProviderForModel(model)
            if (!selectedProvider) {
              throw new Error(`No provider registered for model: ${model}`)
            }

            const qualityConfig = resolveQualityConfig(
              selectedProvider.id,
              model,
              payload.qualityPreset,
            )
            const qualityModel = qualityConfig.model
            const resolvedProvider =
              providerRegistry.getProviderForModel(qualityModel) ?? selectedProvider
            const resolvedModel = providerRegistry.isKnownModel(qualityModel) ? qualityModel : model

            if (resolvedProvider.id !== selectedProvider.id) {
              throw new Error('Quality preset cannot switch provider families.')
            }

            const resolvedProviderConfig = settings.providers[resolvedProvider.id]
            if (!resolvedProviderConfig?.enabled) {
              throw new Error(`${resolvedProvider.displayName} is disabled in settings`)
            }
            if (resolvedProvider.requiresApiKey && !resolvedProviderConfig.apiKey) {
              throw new Error(`No API key configured for ${resolvedProvider.displayName}`)
            }

            return {
              provider: resolvedProvider,
              providerConfig: resolvedProviderConfig,
              resolvedModel,
              qualityConfig,
            }
          },
        )

        context = {
          runId,
          conversation,
          model: resolvedModel,
          settings,
          signal,
          projectPath: conversation.projectPath ?? process.cwd(),
          hasProject: !!conversation.projectPath,
          provider,
          providerConfig,
        }
        const runContext = context

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
          const existingMessages = conversationToMessages(conversation.messages)
          const newUserMessage: SimpleChatMessage = {
            role: 'user',
            content: buildUserChatContent(provider.id, payload),
          }
          const allMessages = [...existingMessages, newUserMessage]

          return chat({
            adapter,
            messages: allMessages,
            systemPrompts: [systemPrompt],
            tools,
            temperature: qualityConfig.temperature,
            topP: qualityConfig.topP,
            maxTokens: qualityConfig.maxTokens,
            modelOptions: qualityConfig.modelOptions,
            agentLoopStrategy: maxIterations(MAX_ITERATIONS),
            abortController,
          })
        })

        await withStageTiming(stageDurationsMs, 'stream-processing', async () => {
          for await (const chunk of stream) {
            if (signal.aborted) break

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

        const finalParts = collector.finalizeParts()
        const stats = collector.getStats()

        await notifyRunComplete(hooks, runContext, {
          promptFragmentIds,
          stageDurationsMs,
          toolCalls: stats.toolCalls,
          toolErrors: stats.toolErrors,
        })

        const userMsg = makeMessage('user', buildPersistedUserMessageParts(payload))
        const assistantMsg = makeMessage('assistant', finalParts, resolvedModel)

        return { newMessages: [userMsg, assistantMsg], finalMessage: assistantMsg }
      } catch (error) {
        if (context && !runErrorNotified) {
          const runError = error instanceof Error ? error : new Error(String(error))
          await notifyRunError(hooks, context, runError)
        }
        throw error
      }
    },
  )
}
