import { jsonObjectSchema } from '@shared/schemas/validation'
import {
  type ConversationId,
  OrchestrationRunId,
  OrchestrationTaskId,
  type SupportedModelId,
} from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { AnyTextAdapter } from '@tanstack/ai'
import type {
  OpenWaggleTaskExecutionInput,
  OrchestrationEvent,
  OrchestrationRunRecord,
  OrchestrationTaskOutputValue,
} from '../engine'
import { summarizeConversation } from './conversation-summary'
import { createModelRunner } from './model-runner'
import {
  buildPlannerPrompt,
  getPlanTaskCount,
  hasWebIntent,
  type PlannedTask,
  type PlannerDecision,
  parsePlannerDecision,
} from './planner'
import { buildExecutionPrompt, buildSynthesisPrompt } from './prompts'
import { StreamSession } from './stream-session'
import { TaskProgressTracker } from './task-progress'
import type {
  OrchestratedAgentRunParams,
  OrchestratedAgentRunResult,
  OrchestrationServiceDeps,
  SamplingConfig,
} from './types'

interface RunnerContext {
  readonly params: OrchestratedAgentRunParams
  readonly deps: OrchestrationServiceDeps
  readonly modelRunner: ReturnType<typeof createModelRunner>
  readonly runStore: ReturnType<OrchestrationServiceDeps['runRepository']['createRunStore']>
  readonly fallbackState: { used: boolean; reason: string | undefined }
  readonly quality: SamplingConfig & { readonly model: SupportedModelId }
  readonly adapter: AnyTextAdapter
  readonly orchestrationMode: 'orchestrated' | 'auto-fallback'
  readonly projectContext: Awaited<ReturnType<OrchestrationServiceDeps['gatherProjectContext']>>
  readonly executorTools: Awaited<ReturnType<OrchestrationServiceDeps['createExecutorTools']>>
  readonly streamSession: StreamSession
  readonly elapsed: () => string
}

interface PlannerStageResult {
  readonly webIntentDetected: boolean
  readonly planResult: JsonValue
  readonly plannerDecision: PlannerDecision
}

interface OrchestrationStageInput {
  readonly context: RunnerContext
  readonly plannerStage: PlannerStageResult
}

interface PrepareContextResult {
  readonly kind: 'ready'
  readonly context: RunnerContext
}

interface PrepareFallbackResult {
  readonly kind: 'fallback'
  readonly result: OrchestratedAgentRunResult
}

type PrepareRunResult = PrepareContextResult | PrepareFallbackResult

export function createOrchestratedAgentRunner(
  deps: OrchestrationServiceDeps,
): (params: OrchestratedAgentRunParams) => Promise<OrchestratedAgentRunResult> {
  const modelRunner = createModelRunner(deps)

  return async function runOrchestratedAgent(
    params: OrchestratedAgentRunParams,
  ): Promise<OrchestratedAgentRunResult> {
    let context: RunnerContext | undefined

    try {
      const prepared = await prepareRunnerContext(params, deps, modelRunner)
      if (prepared.kind === 'fallback') {
        return prepared.result
      }

      context = prepared.context
      context.streamSession.startRun()

      const plannerStage = await runPlannerStage(context)
      if (shouldUseDirectPath(plannerStage)) {
        return await runDirectStage(context, plannerStage.plannerDecision)
      }
      return await runOrchestrationStage({ context, plannerStage })
    } catch (error) {
      if (context) {
        return handleRunnerError(context, error)
      }
      return handlePreRunError(params, deps, error)
    }
  }
}

async function prepareRunnerContext(
  params: OrchestratedAgentRunParams,
  deps: OrchestrationServiceDeps,
  modelRunner: ReturnType<typeof createModelRunner>,
): Promise<PrepareRunResult> {
  const { conversationId, conversation, model, payload, settings, signal, runId, emitChunk } =
    params

  const fallbackState: { used: boolean; reason: string | undefined } = {
    used: false,
    reason: undefined,
  }
  const runStore = deps.runRepository.createRunStore(conversationId, fallbackState)

  const projectConfig = await deps.loadProjectConfig(conversation.projectPath ?? '')
  const resolution = await deps.resolveProviderAndQuality(
    model,
    payload.qualityPreset,
    settings.providers,
    projectConfig.quality,
  )

  if (deps.isResolutionError(resolution)) {
    return {
      kind: 'fallback',
      result: {
        status: 'fallback',
        runId,
        reason: resolution.reason,
      },
    }
  }

  const { provider, providerConfig, qualityConfig: quality } = resolution
  const t0 = deps.now()

  const modelOptionsResult =
    quality.modelOptions === undefined ? null : jsonObjectSchema.safeParse(quality.modelOptions)
  if (modelOptionsResult && !modelOptionsResult.success) {
    deps.logger.warn('invalid modelOptions shape, dropping options for orchestration run')
  }
  const normalizedQuality: SamplingConfig & { readonly model: SupportedModelId } = {
    ...quality,
    modelOptions: modelOptionsResult?.success ? modelOptionsResult.data : undefined,
  }

  const adapter = provider.createAdapter(
    normalizedQuality.model,
    providerConfig.apiKey ?? '',
    providerConfig.baseUrl,
    providerConfig.authMethod,
  )
  const orchestrationMode =
    settings.orchestrationMode === 'orchestrated' ? 'orchestrated' : 'auto-fallback'

  const [projectContext, executorTools] = await Promise.all([
    deps.gatherProjectContext(conversation.projectPath),
    deps.createExecutorTools(conversation.projectPath, signal),
  ])

  const streamSession = new StreamSession({
    runId,
    threadId: String(conversationId),
    messageId: deps.randomId(),
    emitChunk,
    now: deps.now,
    sleep: deps.sleep,
    chunkSize: deps.streamChunkSize,
    chunkDelayMs: deps.streamChunkDelayMs,
  })

  return {
    kind: 'ready',
    context: {
      params,
      deps,
      modelRunner,
      runStore,
      fallbackState,
      quality: normalizedQuality,
      adapter,
      orchestrationMode,
      projectContext,
      executorTools,
      streamSession,
      elapsed: () => `${deps.now() - t0}ms`,
    },
  }
}

async function runPlannerStage(context: RunnerContext): Promise<PlannerStageResult> {
  const { deps, params, projectContext, quality, modelRunner, adapter } = context

  const webIntentDetected = hasWebIntent(params.payload.text)
  if (webIntentDetected) {
    deps.logger.info('web intent detected — forcing task decomposition')
  }

  const plannerPrompt = buildPlannerPrompt(
    projectContext.text,
    params.payload.text,
    webIntentDetected,
  )
  const plannerQuality = buildPlannerQuality(quality, deps)

  deps.logger.info('planner call starting', {
    elapsed: context.elapsed(),
    promptLength: plannerPrompt.length,
  })

  const planResult = await modelRunner.modelJson(
    adapter,
    plannerPrompt,
    plannerQuality,
    // No chunk forwarding — StreamSession manages renderer-facing events.
  )

  deps.logger.info('planner call completed', {
    elapsed: context.elapsed(),
    planResult: JSON.stringify(planResult).slice(0, 200),
  })

  return {
    webIntentDetected,
    planResult,
    plannerDecision: parsePlannerDecision(planResult),
  }
}

function shouldUseDirectPath(plannerStage: PlannerStageResult): boolean {
  return !plannerStage.webIntentDetected && plannerStage.plannerDecision.kind === 'direct'
}

async function runDirectStage(
  context: RunnerContext,
  plannerDecision: PlannerDecision,
): Promise<OrchestratedAgentRunResult> {
  if (plannerDecision.kind !== 'direct') {
    return {
      status: 'failed',
      runId: context.params.runId,
      reason: 'invalid planner decision for direct stage',
      newMessages: [],
    }
  }

  context.deps.logger.info('direct response path — skipping orchestration')
  await context.streamSession.streamText(plannerDecision.response)
  context.streamSession.closeMessage()
  context.streamSession.finishRun()

  return {
    status: 'completed',
    runId: context.params.runId,
    newMessages: createCompletionMessages(context),
  }
}

async function runOrchestrationStage({
  context,
  plannerStage,
}: OrchestrationStageInput): Promise<OrchestratedAgentRunResult> {
  const { deps, params, plannerDecision } = {
    deps: context.deps,
    params: context.params,
    plannerDecision: plannerStage.plannerDecision,
  }

  deps.logger.info('orchestrated path', {
    elapsed: context.elapsed(),
    taskCount: getPlanTaskCount(plannerStage.planResult),
  })

  const tasks = getPlannedTasks(plannerDecision)
  const tracker = new TaskProgressTracker(tasks, deps.now)

  if (plannerDecision.kind === 'tasks' && plannerDecision.ackText) {
    context.streamSession.appendText(`${plannerDecision.ackText}\n\n`)
  }

  let synthesisDone = false

  const orchestrationResult = await deps.runOpenWaggleOrchestration({
    runId: params.runId,
    mode: context.orchestrationMode,
    userPrompt: params.payload.text,
    signal: params.signal,
    maxContextTokens: 1500,
    maxParallelTasks: 4,
    runStore: context.runStore,
    planner: {
      async plan() {
        return plannerStage.planResult
      },
    },
    executor: {
      async execute(input: OpenWaggleTaskExecutionInput) {
        return executeTask(context, input, tracker)
      },
    },
    synthesizer: {
      async synthesize(input) {
        context.streamSession.appendText('---\n\n')
        const text = await synthesizeStreaming(context, input.run.outputs)
        synthesisDone = true
        return text
      },
    },
    onEvent: async (event) => {
      handleOrchestrationEvent({
        event,
        conversationId: params.conversationId,
        emitEvent: params.emitEvent,
        streamSession: context.streamSession,
        tracker,
      })
    },
  })

  if (orchestrationResult.usedFallback) {
    context.fallbackState.used = true
    context.fallbackState.reason = orchestrationResult.fallbackReason
    context.streamSession.closeMessage()
    context.streamSession.handoffToFallback()
    return {
      status: 'fallback',
      runId: params.runId,
      reason: orchestrationResult.fallbackReason,
    }
  }

  const runStatus = orchestrationResult.runStatus ?? 'completed'
  if (runStatus === 'cancelled') {
    context.streamSession.closeMessage()
    context.streamSession.finishRun()
    return { status: 'cancelled', runId: params.runId, newMessages: [] }
  }

  if (runStatus === 'failed') {
    const failureMessage = buildFailureMessage(orchestrationResult.run, tracker)
    context.streamSession.appendText(`\n⚠ ${failureMessage}\n`)
    context.streamSession.closeMessage()
    context.streamSession.finishRun()
    return {
      status: 'failed',
      runId: params.runId,
      reason: failureMessage,
      newMessages: [],
    }
  }

  if (!synthesisDone && orchestrationResult.text) {
    context.streamSession.appendText('---\n\n')
    await context.streamSession.streamText(orchestrationResult.text)
  }
  context.streamSession.closeMessage()
  context.streamSession.finishRun()

  return {
    status: 'completed',
    runId: params.runId,
    newMessages: createCompletionMessages(context),
  }
}

async function executeTask(
  context: RunnerContext,
  input: OpenWaggleTaskExecutionInput,
  tracker: TaskProgressTracker,
): Promise<{ text: string }> {
  const executionPrompt = buildExecutionPrompt({
    task: input.task,
    projectContextText: context.projectContext.text,
    dependencyOutputs: input.dependencyOutputs,
    includeConversationSummary: input.includeConversationSummary,
    conversationSummaryText: summarizeConversation(context.params.conversation),
  })

  const tools = input.task.kind === 'synthesis' ? [] : context.executorTools
  const text = await context.modelRunner.modelTextWithTools(
    context.adapter,
    executionPrompt,
    context.quality,
    tools,
    input.reportProgress,
    // Intentionally omitted: raw executor chunks (STEP_STARTED/STEP_FINISHED) must NOT
    // reach the renderer — they carry accumulated text/thinking content that corrupts
    // useChat's message state. StreamSession manages all renderer-facing AG-UI events.
  )
  tracker.recordTaskOutput(String(input.task.id), text)
  return { text }
}

async function synthesizeStreaming(
  context: RunnerContext,
  outputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>,
): Promise<string> {
  context.deps.logger.info('synthesis starting', {
    taskCount: Object.keys(outputs).length,
    outputKeys: Object.keys(outputs),
  })

  const synthesisPrompt = buildSynthesisPrompt({
    userPrompt: context.params.payload.text,
    projectContextText: context.projectContext.text,
    outputs,
  })

  const result = await context.modelRunner.modelText(
    context.adapter,
    synthesisPrompt,
    context.quality,
    (chunk) => {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        context.streamSession.appendText(chunk.delta)
      }
      // modelText() only forwards TEXT_MESSAGE_CONTENT to onChunk;
      // all other chunk types are dropped by its catchAll handler.
    },
  )

  context.deps.logger.info('synthesis completed', { resultLength: result.length })
  return result
}

function createCompletionMessages(context: RunnerContext) {
  const userMsg = context.deps.makeMessage(
    'user',
    context.deps.buildPersistedUserMessageParts(context.params.payload),
  )
  const assistantMsg = context.deps.makeMessage(
    'assistant',
    [{ type: 'text', text: context.streamSession.text }],
    context.quality.model,
    {
      orchestrationRunId: context.params.runId,
      usedFallback: false,
    },
  )

  return [userMsg, assistantMsg] as const
}

function buildPlannerQuality(
  quality: SamplingConfig & { readonly model: SupportedModelId },
  deps: OrchestrationServiceDeps,
): SamplingConfig {
  return {
    ...quality,
    maxTokens: Math.max(quality.maxTokens, 8192),
    modelOptions: deps.isReasoningModel(quality.model)
      ? { ...quality.modelOptions, reasoning: { effort: 'low', summary: 'auto' } }
      : quality.modelOptions,
  }
}

function getPlannedTasks(plannerDecision: PlannerDecision): readonly PlannedTask[] {
  if (plannerDecision.kind !== 'tasks') {
    return []
  }
  return plannerDecision.tasks
}

async function handleRunnerError(
  context: RunnerContext,
  error: unknown,
): Promise<OrchestratedAgentRunResult> {
  if (isAbortError(error)) {
    context.deps.logger.info('orchestration aborted by signal')
    context.streamSession.closeMessage()
    context.streamSession.finishRun()
    return { status: 'cancelled', runId: context.params.runId, newMessages: [] }
  }

  const reason = error instanceof Error ? error.message : String(error)
  context.deps.logger.error('orchestration failed, falling back', { error: reason })
  context.streamSession.appendText(
    `\nOrchestration encountered an issue: ${reason}. Falling back to direct execution.\n`,
  )
  context.streamSession.closeMessage()
  context.streamSession.handoffToFallback()
  return { status: 'fallback', runId: context.params.runId, reason }
}

function handlePreRunError(
  params: OrchestratedAgentRunParams,
  deps: OrchestrationServiceDeps,
  error: unknown,
): OrchestratedAgentRunResult {
  if (isAbortError(error)) {
    deps.logger.info('orchestration aborted before stream setup')
    return { status: 'cancelled', runId: params.runId, newMessages: [] }
  }

  const reason = error instanceof Error ? error.message : String(error)
  deps.logger.error('orchestration failed before stream setup, falling back', { error: reason })
  return { status: 'fallback', runId: params.runId, reason }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  return error.message.trim().toLowerCase() === 'aborted'
}

function buildFailureMessage(
  run: OrchestrationRunRecord | undefined,
  tracker: TaskProgressTracker,
): string {
  const failedTask = run?.taskOrder
    .map((taskId) => run.tasks[String(taskId)])
    .find((task) => task?.status === 'failed')

  if (!failedTask) {
    return 'orchestration run failed'
  }

  const failedTaskId = String(failedTask.id)
  const failedTitle = tracker.getTaskTitle(failedTaskId)
  if (!failedTitle) {
    return failedTask.error ?? 'orchestration run failed'
  }
  return `Task "${failedTitle}" failed: ${failedTask.error ?? 'unknown error'}`
}

interface HandleOrchestrationEventInput {
  readonly event: OrchestrationEvent
  readonly conversationId: ConversationId
  readonly emitEvent: (payload: Parameters<OrchestratedAgentRunParams['emitEvent']>[0]) => void
  readonly streamSession: StreamSession
  readonly tracker: TaskProgressTracker
}

function handleOrchestrationEvent({
  event,
  conversationId,
  emitEvent,
  streamSession,
  tracker,
}: HandleOrchestrationEventInput): void {
  const taskId = getTaskId(event)

  if (event.type === 'task_started' && taskId) {
    const narration = tracker.onTaskStarted(taskId)
    const title = tracker.getTaskTitle(taskId) ?? taskId
    const text = narration ?? `Working on: ${title}`
    streamSession.appendText(`${text}\n\n`)
  }

  if (event.type === 'task_progress' && taskId) {
    const payload = 'payload' in event ? event.payload : event
    const line = tracker.onTaskProgress(taskId, payload)
    if (line) {
      streamSession.appendText(`- ${line}\n`)
    }
  }

  if (event.type === 'task_succeeded' && taskId) {
    const summary = tracker.onTaskSucceeded(taskId)
    streamSession.appendText(`\n${summary}\n\n`)
  }

  emitEvent({
    conversationId,
    runId: OrchestrationRunId(event.runId),
    type: event.type,
    at: event.at,
    taskId: taskId ? OrchestrationTaskId(taskId) : undefined,
    taskKind: taskId ? tracker.getTaskKind(taskId) : undefined,
    detail: event,
  })
}

function getTaskId(event: OrchestrationEvent): string {
  if (!('taskId' in event)) return ''
  if (!event.taskId) return ''
  return String(event.taskId)
}
