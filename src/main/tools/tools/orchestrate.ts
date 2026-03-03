import { randomUUID } from 'node:crypto'
import { OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import { z } from 'zod'
import { createLogger } from '../../logger'
import type { OpenWaggleTaskExecutionInput } from '../../orchestration/engine/types'
import { emitOrchestrationEvent } from '../../utils/stream-bridge'
import { defineOpenWaggleTool } from '../define-tool'

const MIN_ARG_1 = 2
const MAX_ARG_1 = 5
const MAX_PARALLEL_TASKS = 4

const logger = createLogger('tool:orchestrate')

const taskSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the task'),
  title: z.string().min(1).describe('Short descriptive title'),
  prompt: z.string().min(1).describe('Detailed instructions for the sub-agent'),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe('IDs of tasks that must complete before this one starts'),
})

export const orchestrateTool = defineOpenWaggleTool({
  name: 'orchestrate',
  description:
    'Spawn parallel sub-agents to execute 2-5 independent tasks simultaneously. Each task is executed by a sub-agent with access to project files (readFile, glob, webFetch). Results are synthesized into a combined response. Use this when you have multiple independent sub-tasks that benefit from parallel execution. Do not use for sequential tasks where each step depends on the previous one.',
  needsApproval: false,
  inputSchema: z.object({
    tasks: z
      .array(taskSchema)
      .min(MIN_ARG_1)
      .max(MAX_ARG_1)
      .describe('The tasks to execute in parallel. 2-5 tasks.'),
  }),
  async execute(args, context) {
    const { projectPath, signal, conversationId } = context
    const runId = randomUUID()

    // ── Lazy imports ──
    // All orchestration modules are imported dynamically to avoid triggering
    // electron-store initialization at module load time. This module is imported
    // transitively by built-in-tools which is loaded in test environments where
    // electron-store is not available.
    const [
      { getSettings },
      { loadProjectConfig },
      { isResolutionError, resolveProviderAndQuality },
      { runOpenWaggleOrchestration },
      { gatherProjectContext, createExecutorTools },
      { defaultOrchestrationServiceDeps },
      { createModelRunner },
      { buildExecutionPrompt, buildSynthesisPrompt },
    ] = await Promise.all([
      import('../../store/settings'),
      import('../../config/project-config'),
      import('../../agent/shared'),
      import('../../orchestration/engine'),
      import('../../orchestration/project-context'),
      import('../../orchestration/service/deps'),
      import('../../orchestration/service/model-runner'),
      import('../../orchestration/service/prompts'),
    ])

    // ── Resolve provider + quality ──
    const settings = getSettings()
    const projectConfig = await loadProjectConfig(projectPath)
    const resolution = await resolveProviderAndQuality(
      settings.defaultModel,
      settings.qualityPreset,
      settings.providers,
      projectConfig.quality,
    )

    if (isResolutionError(resolution)) {
      return `Error: ${resolution.reason}`
    }

    const { provider, providerConfig, qualityConfig } = resolution
    const adapter = provider.createAdapter(
      qualityConfig.model,
      providerConfig.apiKey,
      providerConfig.baseUrl,
      providerConfig.authMethod,
    )

    // ── Gather context and tools ──
    const [projectContext, executorTools] = await Promise.all([
      gatherProjectContext(projectPath),
      createExecutorTools(projectPath, signal),
    ])

    const deps = defaultOrchestrationServiceDeps
    const modelRunner = createModelRunner(deps)

    logger.info('orchestrate tool starting', {
      runId,
      conversationId,
      taskCount: args.tasks.length,
      taskIds: args.tasks.map((t) => t.id),
    })

    // ── Build the pre-formatted plan for the orchestration engine ──
    const taskKindLookup = new Map<string, string>()
    const planJson: JsonValue = {
      tasks: args.tasks.map((task) => {
        const base: Record<string, JsonValue> = {
          id: task.id,
          kind: 'general',
          title: task.title,
          prompt: task.prompt,
        }
        taskKindLookup.set(task.id, 'general')
        if (task.dependsOn && task.dependsOn.length > 0) {
          base.dependsOn = task.dependsOn
        }
        return base
      }),
    }

    // ── Run orchestration with pre-planned tasks ──
    const result = await runOpenWaggleOrchestration({
      runId,
      userPrompt: args.tasks.map((t) => `[${t.id}] ${t.title}: ${t.prompt}`).join('\n'),
      signal,
      maxParallelTasks: MAX_PARALLEL_TASKS,
      planner: {
        async plan() {
          return planJson
        },
      },
      executor: {
        async execute(input: OpenWaggleTaskExecutionInput) {
          const executionPrompt = buildExecutionPrompt({
            task: input.task,
            projectContextText: projectContext.text,
            dependencyOutputs: input.dependencyOutputs,
            includeConversationSummary: false,
            conversationSummaryText: '',
          })

          const tools = input.task.kind === 'synthesis' ? [] : executorTools
          const text = await modelRunner.modelTextWithTools(
            adapter,
            executionPrompt,
            qualityConfig,
            tools,
            input.reportProgress,
          )
          return { text }
        },
      },
      synthesizer: {
        async synthesize(input) {
          const synthesisPrompt = buildSynthesisPrompt({
            userPrompt: input.userPrompt,
            projectContextText: projectContext.text,
            outputs: input.run.outputs,
          })
          return modelRunner.modelText(adapter, synthesisPrompt, qualityConfig)
        },
      },
      onEvent: (event) => {
        const taskId = 'taskId' in event && event.taskId ? String(event.taskId) : undefined
        const payload: OrchestrationEventPayload = {
          conversationId,
          runId: OrchestrationRunId(event.runId),
          type: event.type,
          at: event.at,
          taskId: taskId ? OrchestrationTaskId(taskId) : undefined,
          taskKind: taskId ? taskKindLookup.get(taskId) : undefined,
          detail: event,
        }
        emitOrchestrationEvent(payload)
      },
    })

    logger.info('orchestrate tool completed', {
      runId: result.runId,
      usedFallback: result.usedFallback,
      runStatus: result.runStatus,
      resultLength: result.text.length,
    })

    if (result.usedFallback) {
      return `Orchestration fell back to direct execution: ${result.fallbackReason ?? 'unknown reason'}\n\n${result.text}`
    }

    if (result.runStatus === 'failed') {
      return `Some tasks failed during orchestration. Partial results:\n\n${result.text || 'No output produced.'}`
    }

    if (result.runStatus === 'cancelled') {
      return 'Orchestration was cancelled.'
    }

    return result.text || 'Orchestration completed but produced no output.'
  },
})
