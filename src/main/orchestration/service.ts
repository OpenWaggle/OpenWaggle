import { randomUUID } from 'node:crypto'
import {
  extractJson,
  type OpenHiveProgressPayload,
  type OpenHiveTaskExecutionInput,
  runOpenHiveOrchestration,
} from '@openhive/condukt-openhive'
import type { AgentSendPayload, Message } from '@shared/types/agent'
import { type ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { Settings } from '@shared/types/settings'
import {
  type AnyTextAdapter,
  chat,
  maxIterations,
  type ServerTool,
  type StreamChunk,
} from '@tanstack/ai'
import { z } from 'zod'
import { isReasoningModel } from '../agent/quality-config'
import {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  isResolutionError,
  makeMessage,
  resolveProviderAndQuality,
} from '../agent/shared'
import { loadProjectConfig } from '../config/project-config'
import { createLogger } from '../logger'
import { createExecutorTools, gatherProjectContext } from './project-context'
import { orchestrationRunRepository } from './run-repository'

const directPlanResultSchema = z.object({
  direct: z.literal(true),
  response: z.string(),
})

const taskPlanResultSchema = z.object({
  ackText: z.string().optional(),
  tasks: z.array(z.object({ id: z.string() }).passthrough()),
})

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

  const projectConfig = await loadProjectConfig(conversation.projectPath ?? '')
  const resolution = resolveProviderAndQuality(
    model,
    payload.qualityPreset,
    settings.providers,
    projectConfig.quality,
  )
  if (isResolutionError(resolution)) {
    return { status: 'fallback', runId, reason: resolution.reason }
  }

  const { provider, providerConfig, qualityConfig: quality } = resolution
  const t0 = Date.now()
  const elapsed = (): string => `${Date.now() - t0}ms`

  const adapter = provider.createAdapter(
    quality.model,
    providerConfig.apiKey ?? '',
    providerConfig.baseUrl,
  ) as AnyTextAdapter
  const orchestrationMode =
    settings.orchestrationMode === 'orchestrated' ? 'orchestrated' : 'auto-fallback'

  const projectContext = await gatherProjectContext(conversation.projectPath)
  const executorTools = createExecutorTools(conversation.projectPath, signal)

  // --- Pre-planning step ---
  // Run the planner BEFORE orchestration so we can short-circuit for direct responses.
  // We emit RUN_STARTED immediately so `isLoading` is true and the thinking spinner shows,
  // but delay TEXT_MESSAGE_START until we have real content from the planner.
  const ackMessageId = randomUUID()
  emitChunk({ type: 'RUN_STARTED', timestamp: Date.now(), runId, threadId: String(conversationId) })

  let messageStarted = false
  let fullText = ''
  const ensureMessageStarted = (): void => {
    if (messageStarted) return
    messageStarted = true
    emitChunk({
      type: 'TEXT_MESSAGE_START',
      timestamp: Date.now(),
      messageId: ackMessageId,
      role: 'assistant',
    })
  }
  const appendText = (delta: string): void => {
    ensureMessageStarted()
    fullText += delta
    emitChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: Date.now(),
      messageId: ackMessageId,
      delta,
    })
  }

  try {
    const webIntentDetected = hasWebIntent(payload.text)
    if (webIntentDetected) {
      logger.info('web intent detected — forcing task decomposition')
    }

    const plannerPrompt = buildPlannerPrompt(projectContext.text, payload.text, webIntentDetected)
    // Planner needs high output budget (structured JSON) but low reasoning effort
    const plannerQuality: SamplingConfig = {
      ...quality,
      maxTokens: Math.max(quality.maxTokens, 8192),
      modelOptions: isReasoningModel(quality.model)
        ? { ...quality.modelOptions, reasoning: { effort: 'low', summary: 'auto' } }
        : quality.modelOptions,
    }
    logger.info('planner call starting', { elapsed: elapsed(), promptLength: plannerPrompt.length })
    const planResult = await modelJson(adapter, plannerPrompt, plannerQuality, emitChunk)
    logger.info('planner call completed', {
      elapsed: elapsed(),
      planResult: JSON.stringify(planResult).slice(0, 200),
    })

    // --- Direct response path — skip orchestration entirely ---
    if (!webIntentDetected && isDirectPlanResult(planResult)) {
      logger.info('direct response path — skipping orchestration')
      ensureMessageStarted()
      const directText = planResult.response
      await streamText(emitChunk, ackMessageId, directText)
      fullText += directText
      emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
      emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })

      const userMsg = makeMessage('user', buildPersistedUserMessageParts(payload))
      const assistantMsg = makeMessage(
        'assistant',
        [{ type: 'text', text: fullText }],
        quality.model,
        { orchestrationRunId: runId, usedFallback: false },
      )
      return { status: 'completed', runId, newMessages: [userMsg, assistantMsg] }
    }

    // --- Orchestrated path — single streaming narrative ---
    const taskCount = getPlanTaskCount(planResult)
    logger.info('orchestrated path', { elapsed: elapsed(), taskCount })

    // Stream the real ack text from the planner
    const ackText = getPlanAckText(planResult)
    if (ackText) appendText(`${ackText}\n\n`)

    // 2. Build task metadata for narration + tracking
    const planTasks = getPlanTasks(planResult)
    const taskNarrations = new Map<string, string>()
    const taskTitles = new Map<string, string>()
    const taskStartTimes = new Map<string, number>()
    const taskFileCount = new Map<string, number>()
    const taskTokens = new Map<string, number>()
    for (const t of planTasks) {
      const task = t as Record<string, unknown>
      const id = String(task.id ?? '')
      if (task.narration && typeof task.narration === 'string') {
        taskNarrations.set(id, task.narration)
      }
      taskTitles.set(id, typeof task.title === 'string' ? task.title : id)
    }

    // 3. Run orchestration — stream narration + progress into the same message
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
          return planResult
        },
      },
      executor: {
        async execute(input: OpenHiveTaskExecutionInput) {
          const executionPrompt = [
            `Task: ${input.task.title}`,
            `Task kind: ${input.task.kind}`,
            `Instruction: ${input.task.prompt}`,
            '',
            ...(projectContext.text ? [projectContext.text, ''] : []),
            'Dependency outputs (JSON):',
            JSON.stringify(input.dependencyOutputs),
            '',
            input.includeConversationSummary
              ? `Conversation context (truncated):\n${summarizeConversation(conversation)}`
              : 'Conversation context omitted by heuristic.',
            '',
            'You have access to readFile and glob tools to explore the project, and webFetch to fetch content from URLs.',
            'Use readFile/glob to read any files you need to produce an accurate, grounded response.',
            'Use webFetch to look up documentation, APIs, or any web content the user asks about.',
            'Do not guess or hallucinate file contents — read the actual files.',
            '',
            'IMPORTANT — be persistent and adaptive with webFetch:',
            '- If a URL returns an error, analyze WHY it failed (404? timeout? wrong domain?) and adapt your next attempt.',
            '- Try variations: different paths, with/without www, trailing slashes, /docs vs /documentation, /latest vs /overview.',
            '- If the specific page fails, fetch the root domain first to discover the correct URL structure from links in the page.',
            '- If one domain fails entirely, try alternatives (e.g. GitHub README, npm page, official blog).',
            '- Learn from each attempt — if /v1/docs 404s but the root page mentions /ai/latest/docs, use that.',
            '- Never give up after a single failure. Iterate until you find working content or exhaust all reasonable alternatives.',
            '- Your goal is to deliver the information the user requested, not to report fetch errors.',
            '',
            'Return concise, high-signal result as plain text.',
          ].join('\n')
          const tools = input.task.kind === 'synthesis' ? [] : executorTools
          const text = await modelTextWithTools(
            adapter,
            executionPrompt,
            quality,
            tools,
            input.reportProgress,
            emitChunk,
          )
          taskTokens.set(String(input.task.id), Math.ceil(text.length / 4))
          return { text }
        },
      },
      synthesizer: {
        async synthesize(input) {
          logger.info('synthesis starting', {
            taskCount: input.run.taskOrder.length,
            outputKeys: Object.keys(input.run.outputs),
          })
          const synthesisPrompt = [
            'Synthesize the final assistant response from orchestration outputs.',
            'Keep it actionable and concise.',
            '',
            `Original user request: ${input.userPrompt}`,
            '',
            ...(projectContext.text ? [projectContext.text, ''] : []),
            'Task outputs (JSON):',
            JSON.stringify(input.run.outputs, null, 2),
          ].join('\n')
          const result = await modelText(adapter, synthesisPrompt, quality, emitChunk)
          logger.info('synthesis completed', { resultLength: result.length })
          return result
        },
      },
      onEvent: async (event) => {
        const taskId = 'taskId' in event ? String(event.taskId ?? '') : ''

        // Stream narration when a task starts
        if (event.type === 'task_started' && taskId) {
          taskStartTimes.set(taskId, Date.now())
          const narration = taskNarrations.get(taskId)
          if (narration) {
            appendText(`${narration}\n\n`)
          }
        }

        // Stream tool activity as it happens
        if (event.type === 'task_progress' && taskId) {
          const detail = event as Record<string, unknown>
          const payload = (detail.payload ?? detail) as Record<string, unknown>
          if (payload.type === 'tool_end') {
            const line = formatToolActivity(
              String(payload.toolName ?? ''),
              payload.toolInput as Record<string, unknown> | undefined,
            )
            if (line) {
              taskFileCount.set(taskId, (taskFileCount.get(taskId) ?? 0) + 1)
              appendText(`- ${line}\n`)
            }
          }
        }

        // Stream task completion summary
        if (event.type === 'task_succeeded' && taskId) {
          const title = taskTitles.get(taskId) ?? taskId
          const files = taskFileCount.get(taskId) ?? 0
          const tokens = taskTokens.get(taskId) ?? 0
          const startTime = taskStartTimes.get(taskId) ?? Date.now()
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          const parts: string[] = []
          if (files > 0) parts.push(`${String(files)} files`)
          if (tokens > 0) parts.push(`~${String(tokens)} output tokens`)
          parts.push(`${elapsed}s`)
          appendText(`\n✓ ${title} — ${parts.join(', ')}\n\n`)
        }

        // Also emit orchestration event for the run record
        emitEvent({
          conversationId,
          runId: OrchestrationRunId(event.runId),
          type: event.type,
          at: event.at,
          taskId: taskId ? OrchestrationTaskId(taskId) : undefined,
          detail: event,
        })
      },
    })

    // 4. Handle non-success results
    if (orchestrationResult.usedFallback) {
      fallbackState.used = true
      fallbackState.reason = orchestrationResult.fallbackReason
      if (messageStarted) {
        emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
      }
      return { status: 'fallback', runId, reason: orchestrationResult.fallbackReason }
    }

    const runStatus = orchestrationResult.runStatus ?? 'completed'
    if (runStatus === 'cancelled') {
      if (messageStarted) {
        emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
      }
      emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })
      return { status: 'cancelled', runId, newMessages: [] }
    }

    if (runStatus === 'failed') {
      const failedTask = orchestrationResult.run?.taskOrder
        .map((tid) => orchestrationResult.run?.tasks[String(tid)])
        .find((task) => task?.status === 'failed')
      const failureMessage = failedTask?.error ?? 'orchestration run failed'
      appendText(`\n⚠ ${failureMessage}\n`)
      emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
      emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })
      return { status: 'failed', runId, reason: failureMessage, newMessages: [] }
    }

    // 5. Stream synthesis into the same message
    appendText('---\n\n')
    await streamText(emitChunk, ackMessageId, orchestrationResult.text)
    fullText += orchestrationResult.text

    // 6. Close the single message
    emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
    emitChunk({ type: 'RUN_FINISHED', timestamp: Date.now(), runId, finishReason: 'stop' })

    const userMsg = makeMessage('user', buildPersistedUserMessageParts(payload))
    const assistantMsg = makeMessage(
      'assistant',
      [{ type: 'text', text: fullText }],
      quality.model,
      {
        orchestrationRunId: runId,
        usedFallback: false,
      },
    )

    return {
      status: 'completed',
      runId,
      newMessages: [userMsg, assistantMsg],
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('orchestration failed, falling back', { error: reason })
    // Surface the failure reason in the stream so the user sees why fallback happened.
    appendText(
      `\nOrchestration encountered an issue: ${reason}. Falling back to direct execution.\n`,
    )
    // Close the message if one was started, but do NOT emit RUN_FINISHED —
    // the classic fallback agent will emit its own RUN_STARTED → RUN_FINISHED.
    if (messageStarted) {
      emitChunk({ type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: ackMessageId })
    }
    return {
      status: 'fallback',
      runId,
      reason,
    }
  }
}

interface SamplingConfig {
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Record<string, unknown>
}

const EXECUTOR_MAX_ITERATIONS = 20

async function modelText(
  adapter: AnyTextAdapter,
  prompt: string,
  quality: SamplingConfig,
  onChunk?: (chunk: StreamChunk) => void,
): Promise<string> {
  const samplingOptions = buildSamplingOptions(quality)
  logger.info('modelText: calling chat()', { promptLength: prompt.length })

  const stream = chat({
    adapter,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
    ...samplingOptions,
    maxTokens: quality.maxTokens,
    modelOptions: quality.modelOptions,
  })

  let result = ''
  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      result += chunk.delta
    } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
      onChunk?.(chunk)
    }
  }

  const trimmed = result.trim()
  logger.info('modelText: chat() returned', { outputLength: trimmed.length })
  return trimmed
}

async function modelTextWithTools(
  adapter: AnyTextAdapter,
  prompt: string,
  quality: SamplingConfig,
  tools: ServerTool[],
  reportProgress?: (payload: OpenHiveProgressPayload) => void,
  onChunk?: (chunk: StreamChunk) => void,
): Promise<string> {
  if (tools.length === 0) {
    return modelText(adapter, prompt, quality, onChunk)
  }

  const samplingOptions = buildSamplingOptions(quality)

  const stream = chat({
    adapter,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
    tools,
    ...samplingOptions,
    maxTokens: quality.maxTokens,
    modelOptions: quality.modelOptions,
    agentLoopStrategy: maxIterations(EXECUTOR_MAX_ITERATIONS),
  })

  let result = ''
  let toolCalls = 0
  const pendingArgs = new Map<string, string>()

  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      result += chunk.delta
    } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
      onChunk?.(chunk)
    } else if (chunk.type === 'TOOL_CALL_START') {
      toolCalls++
      pendingArgs.set(chunk.toolCallId, '')
    } else if (chunk.type === 'TOOL_CALL_ARGS') {
      const existing = pendingArgs.get(chunk.toolCallId) ?? ''
      pendingArgs.set(chunk.toolCallId, existing + chunk.delta)
    } else if (chunk.type === 'TOOL_CALL_END') {
      // Prefer chunk.input, fall back to accumulated TOOL_CALL_ARGS
      let toolInput: Record<string, unknown> | undefined
      if (chunk.input && typeof chunk.input === 'object') {
        toolInput = chunk.input as Record<string, unknown>
      } else {
        const argsStr = pendingArgs.get(chunk.toolCallId)
        if (argsStr) {
          try {
            const parsed: unknown = JSON.parse(argsStr)
            if (parsed && typeof parsed === 'object') {
              toolInput = parsed as Record<string, unknown>
            }
          } catch {
            /* ignore parse failures */
          }
        }
      }
      pendingArgs.delete(chunk.toolCallId)
      logger.info('executor tool_end', { toolName: chunk.toolName, toolInput })
      reportProgress?.({
        type: 'tool_end',
        toolName: chunk.toolName,
        toolCallId: chunk.toolCallId,
        toolInput,
      })
    }
  }
  logger.info('executor finished', { resultLength: result.length, toolCalls })
  return result.trim()
}

async function modelJson(
  adapter: AnyTextAdapter,
  prompt: string,
  quality: SamplingConfig,
  onChunk?: (chunk: StreamChunk) => void,
): Promise<unknown> {
  const text = await modelText(adapter, prompt, quality, onChunk)

  // Try direct JSON.parse first (most common case — raw JSON output)
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    // continue to extractJson
  }

  // Try extractJson with code fence handling
  try {
    return extractJson(trimmed)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(
      'modelJson extraction failure — planner output could not be parsed as JSON, returning empty task list',
      {
        reason,
        rawLength: text.length,
        rawStart: text.slice(0, 300),
        rawEnd: text.slice(-100),
      },
    )
    return { tasks: [] }
  }
}

const STREAM_CHUNK_SIZE = 50
const STREAM_CHUNK_DELAY_MS = 12

async function streamText(
  emitChunk: (chunk: StreamChunk) => void,
  messageId: string,
  text: string,
): Promise<void> {
  for (let i = 0; i < text.length; i += STREAM_CHUNK_SIZE) {
    emitChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: Date.now(),
      messageId,
      delta: text.slice(i, i + STREAM_CHUNK_SIZE),
    })
    if (i + STREAM_CHUNK_SIZE < text.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS))
    }
  }
}

function isDirectPlanResult(value: unknown): value is z.infer<typeof directPlanResultSchema> {
  return directPlanResultSchema.safeParse(value).success
}

function getPlanTaskCount(value: unknown): number {
  const result = taskPlanResultSchema.safeParse(value)
  return result.success ? result.data.tasks.length : 0
}

function getPlanAckText(value: unknown): string | null {
  const result = taskPlanResultSchema.safeParse(value)
  if (result.success && result.data.ackText) {
    return result.data.ackText
  }
  return null
}

function getPlanTasks(value: unknown): readonly Record<string, unknown>[] {
  const result = taskPlanResultSchema.safeParse(value)
  return result.success ? result.data.tasks : []
}

function summarizeConversation(conversation: Conversation): string {
  const recentMessages = conversation.messages.slice(-8)
  const rendered = recentMessages
    .map((message) => {
      const segments: string[] = []
      for (const part of message.parts) {
        switch (part.type) {
          case 'text':
            segments.push(part.text)
            break
          case 'tool-call':
            segments.push(`[tool:${part.toolCall.name}]`)
            break
          case 'tool-result':
            segments.push(
              part.toolResult.isError
                ? `[tool-error:${part.toolResult.name}]`
                : `[tool-done:${part.toolResult.name}]`,
            )
            break
        }
      }
      return `${message.role.toUpperCase()}: ${segments.join(' ')}`
    })
    .join('\n')

  return rendered.length > 3000 ? `${rendered.slice(0, 3000)}...` : rendered
}

const TOOL_VERBS: Record<string, string> = {
  readFile: 'Read',
  writeFile: 'Wrote',
  editFile: 'Edited',
  runCommand: 'Ran',
  glob: 'Searched',
  listFiles: 'Listed',
  webFetch: 'Fetched',
}

const TOOL_PRIMARY_ARG: Record<string, string> = {
  readFile: 'path',
  writeFile: 'path',
  editFile: 'path',
  runCommand: 'command',
  glob: 'pattern',
  listFiles: 'path',
  webFetch: 'url',
}

function formatToolActivity(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): string | null {
  const verb = TOOL_VERBS[toolName] ?? toolName
  if (!toolInput) return null

  const argKey = TOOL_PRIMARY_ARG[toolName]
  const value = argKey ? toolInput[argKey] : undefined
  if (typeof value !== 'string') return null

  if (toolName === 'runCommand') return `${verb} \`${value}\``
  return `${verb} ${value}`
}

// --- Web intent detection ---

const WEB_INTENT_KEYWORDS = [
  'go to',
  'visit',
  'look up',
  'check out',
  'browse',
  'fetch',
  'open the',
  'read the docs',
  'official site',
  'official docs',
  'official documentation',
  'official page',
]

const WEB_INTENT_TOKENS = [
  'docs',
  'documentation',
  'website',
  'webpage',
  'web page',
  'url',
  'homepage',
]

const URL_PATTERN = /https?:\/\/\S+/i

/**
 * Deterministic check for web intent in user text.
 * Returns true when the user's message signals they want web content fetched,
 * so the planner prompt omits the direct-response option entirely.
 */
export function hasWebIntent(text: string): boolean {
  if (URL_PATTERN.test(text)) return true
  const lower = text.toLowerCase()
  for (const phrase of WEB_INTENT_KEYWORDS) {
    if (lower.includes(phrase)) return true
  }
  for (const token of WEB_INTENT_TOKENS) {
    // Match as whole word boundary to avoid false positives (e.g. "documentary")
    const pattern = new RegExp(`\\b${token}\\b`, 'i')
    if (pattern.test(lower)) return true
  }
  return false
}

// --- Planner prompt builder ---

const TASK_FORMAT_LINES = [
  'Task response format:',
  '{"ackText":"<brief 1-sentence acknowledgment>","tasks":[{"id":"string","kind":"analysis|debugging|refactoring|testing|documentation|repo-edit|synthesis|general","title":"string","prompt":"string","narration":"<short natural-language intro for this task, e.g. Let me read the core documentation...>","dependsOn":["id"],"needsConversationContext":boolean}]}',
  '',
  'Task constraints:',
  '- 2 to 5 tasks (analysis or general work — do NOT include a synthesis task)',
  '- id must be stable kebab-case',
  '- Each task MUST have a narration — a brief, natural sentence the agent says before starting the task',
  '- dependsOn optional and must reference prior tasks',
  '- The system will automatically synthesize task results — do NOT create a synthesis/summary task',
  '- DO NOT answer the user request yourself — let the task executors do the work',
]

function buildPlannerPrompt(
  projectContextText: string,
  userText: string,
  forceTaskDecomposition: boolean,
): string {
  const lines: string[] = []

  if (projectContextText) {
    lines.push(projectContextText, '')
  }
  lines.push(`User request: ${userText}`, '')

  if (forceTaskDecomposition) {
    // Web intent detected — no direct response option
    lines.push(
      'You are a task planner. The user wants web content fetched.',
      'Return ONLY raw JSON — no markdown, no code fences, no commentary.',
      '',
      'Task executors have tools: readFile, glob (project files), and webFetch (fetch any URL and return text content).',
      'You MUST decompose this into tasks. At least one task MUST use webFetch to fetch the requested web content.',
      'Do NOT answer from your own knowledge — the user wants actual content from the web.',
      '',
      ...TASK_FORMAT_LINES,
    )
  } else {
    // Normal planner — allow direct response for trivial knowledge questions
    lines.push(
      'You are a task planner. Decide how to handle this request.',
      'Return ONLY raw JSON — no markdown, no code fences, no commentary.',
      '',
      'Task executors have tools: readFile, glob (project files), and webFetch (fetch any URL and return text content).',
      '',
      'ONLY use direct response for pure knowledge questions with NO web intent and NO project file access',
      '(e.g. "what is a closure?", "explain the difference between let and const").',
      'Direct response format:',
      '{"direct":true,"response":"your answer"}',
      '',
      'For ANYTHING that involves the project — summaries, analysis, code changes,',
      'debugging, reviewing, explaining project code — ALWAYS decompose into tasks.',
      'For ANYTHING that involves web content — documentation, websites, APIs — ALWAYS decompose into tasks using webFetch.',
      'Each task executor has tools: readFile, glob (project files), webFetch (any URL).',
      ...TASK_FORMAT_LINES,
    )
  }

  return lines.join('\n')
}
