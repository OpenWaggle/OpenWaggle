import { randomUUID } from 'node:crypto'
import {
  type OpenHiveTaskExecutionInput,
  runOpenHiveOrchestration,
} from '@openhive/condukt-openhive'
import type { AgentSendPayload, Message, MessagePart } from '@shared/types/agent'
import { type ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { Settings } from '@shared/types/settings'
import { type AnyTextAdapter, chat, type StreamChunk } from '@tanstack/ai'
import {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  isResolutionError,
  makeMessage,
  resolveProviderAndQuality,
} from '../agent/shared'
import { createLogger } from '../logger'
import { orchestrationRunRepository } from './run-repository'

const logger = createLogger('orchestration')

export interface OrchestratedAgentRunParams {
  readonly runId: string
  readonly conversationId: ConversationId
  readonly conversation: Conversation
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly emitEvent: (payload: OrchestrationEventPayload) => void
  readonly emitChunk: (chunk: StreamChunk) => void
}

export interface OrchestratedAgentRunResult {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'fallback'
  readonly runId: string
  readonly newMessages?: readonly Message[]
  readonly reason?: string
}

export async function runOrchestratedAgent(
  params: OrchestratedAgentRunParams,
): Promise<OrchestratedAgentRunResult> {
  const { conversationId, conversation, payload, model, settings, signal, emitChunk, emitEvent } =
    params
  const { runId } = params
  const fallbackState = { used: false as boolean, reason: undefined as string | undefined }
  const runStore = orchestrationRunRepository.createRunStore(conversationId, fallbackState)

  const resolution = resolveProviderAndQuality(model, payload.qualityPreset, settings.providers)
  if (isResolutionError(resolution)) {
    return { status: 'fallback', runId, reason: resolution.reason }
  }

  const { provider, providerConfig, qualityConfig: quality } = resolution

  const adapter = provider.createAdapter(
    quality.model,
    providerConfig.apiKey ?? '',
    providerConfig.baseUrl,
  ) as AnyTextAdapter
  const orchestrationMode =
    settings.orchestrationMode === 'orchestrated' ? 'orchestrated' : 'auto-fallback'

  try {
    const orchestrationResult = await runOpenHiveOrchestration({
      runId,
      mode: orchestrationMode,
      userPrompt: payload.text,
      signal,
      maxContextTokens: 1500,
      maxParallelTasks: 4,
      runStore,
      planner: {
        async plan() {
          const plannerPrompt = [
            'Create a JSON plan for parallel agent execution.',
            'Output strictly JSON with shape:',
            '{"tasks":[{"id":"string","kind":"analysis|synthesis|repo-edit|general","title":"string","prompt":"string","dependsOn":["id"],"needsConversationContext":boolean}]}',
            'Constraints:',
            '- 1 to 5 tasks',
            '- id must be stable kebab-case',
            '- dependsOn optional and must reference prior tasks',
            '- ensure there is one final synthesis task',
            '',
            `User request: ${payload.text}`,
          ].join('\n')
          return modelJson(adapter, plannerPrompt, quality)
        },
      },
      executor: {
        async execute(input: OpenHiveTaskExecutionInput) {
          const executionPrompt = [
            `Task: ${input.task.title}`,
            `Task kind: ${input.task.kind}`,
            `Instruction: ${input.task.prompt}`,
            '',
            'Dependency outputs (JSON):',
            JSON.stringify(input.dependencyOutputs),
            '',
            input.includeConversationSummary
              ? `Conversation context (truncated):\n${summarizeConversation(conversation)}`
              : 'Conversation context omitted by heuristic.',
            '',
            'Return concise, high-signal result as plain text.',
          ].join('\n')
          const text = await modelText(adapter, executionPrompt, quality)
          return { text }
        },
      },
      synthesizer: {
        async synthesize(input) {
          const synthesisPrompt = [
            'Synthesize the final assistant response from orchestration outputs.',
            'Keep it actionable and concise.',
            '',
            `Original user request: ${input.userPrompt}`,
            '',
            'Task outputs (JSON):',
            JSON.stringify(input.run.outputs, null, 2),
          ].join('\n')
          return modelText(adapter, synthesisPrompt, quality)
        },
      },
      onEvent: async (event) => {
        emitEvent({
          conversationId,
          runId: OrchestrationRunId(event.runId),
          type: event.type,
          at: event.at,
          taskId:
            event.type.startsWith('task_') && 'taskId' in event && event.taskId
              ? OrchestrationTaskId(event.taskId)
              : undefined,
          detail: event,
        })
      },
    })

    if (orchestrationResult.usedFallback) {
      fallbackState.used = true
      fallbackState.reason = orchestrationResult.fallbackReason
      emitEvent({
        conversationId,
        runId: OrchestrationRunId(runId),
        type: 'fallback',
        at: new Date().toISOString(),
        message: orchestrationResult.fallbackReason,
      })
      return {
        status: 'fallback',
        runId,
        reason: orchestrationResult.fallbackReason,
      }
    }

    const runStatus = orchestrationResult.runStatus ?? 'completed'
    if (runStatus === 'cancelled') {
      emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })
      return {
        status: 'cancelled',
        runId,
        newMessages: [],
      }
    }

    if (runStatus === 'failed') {
      const failedTask = orchestrationResult.run?.taskOrder
        .map((taskId) => orchestrationResult.run?.tasks[String(taskId)])
        .find((task) => task?.status === 'failed')
      const failureMessage = failedTask?.error ?? 'orchestration run failed'
      emitChunk({
        type: 'RUN_ERROR',
        timestamp: Date.now(),
        runId,
        error: { message: failureMessage },
      })
      emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })
      return {
        status: 'failed',
        runId,
        reason: failureMessage,
        newMessages: [],
      }
    }

    const text = orchestrationResult.text

    emitChunk({
      type: 'RUN_STARTED',
      timestamp: Date.now(),
      runId,
      threadId: String(conversationId),
    })
    const messageId = randomUUID()
    emitChunk({
      type: 'TEXT_MESSAGE_START',
      timestamp: Date.now(),
      messageId,
      role: 'assistant',
    })
    emitChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: Date.now(),
      messageId,
      delta: text,
    })
    emitChunk({
      type: 'TEXT_MESSAGE_END',
      timestamp: Date.now(),
      messageId,
    })
    emitChunk({
      type: 'RUN_FINISHED',
      timestamp: Date.now(),
      runId,
      finishReason: 'stop',
    })

    const userMsg = makeMessage('user', buildPersistedUserMessageParts(payload))
    const assistantMsg = makeMessage('assistant', [{ type: 'text', text }], quality.model, {
      orchestrationRunId: runId,
      usedFallback: false,
    })

    return {
      status: 'completed',
      runId,
      newMessages: [userMsg, assistantMsg],
    }
  } catch (error) {
    // Let the caller fall back to the classic agent path without terminating
    // the current UI stream prematurely.
    return {
      status: 'fallback',
      runId,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

interface SamplingConfig {
  readonly temperature: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Record<string, unknown>
}

async function modelText(
  adapter: AnyTextAdapter,
  prompt: string,
  quality: SamplingConfig,
): Promise<string> {
  const samplingOptions = buildSamplingOptions(quality)

  const output = await chat({
    adapter,
    stream: false,
    messages: [{ role: 'user', content: prompt }],
    ...samplingOptions,
    maxTokens: quality.maxTokens,
    modelOptions: quality.modelOptions,
  })

  return String(output).trim()
}

async function modelJson(
  adapter: AnyTextAdapter,
  prompt: string,
  quality: SamplingConfig,
): Promise<unknown> {
  const text = await modelText(adapter, prompt, quality)
  try {
    return JSON.parse(text) as unknown
  } catch {
    logger.warn('modelJson parse failure', { raw: text.slice(0, 200) })
    return { tasks: [] }
  }
}

function summarizeConversation(conversation: Conversation): string {
  const recentMessages = conversation.messages.slice(-8)
  const rendered = recentMessages
    .map((message) => {
      const text = message.parts
        .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
      return `${message.role.toUpperCase()}: ${text}`
    })
    .join('\n')

  return rendered.length > 3000 ? `${rendered.slice(0, 3000)}...` : rendered
}
