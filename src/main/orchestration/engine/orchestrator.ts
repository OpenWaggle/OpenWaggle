import type { JsonValue } from '@shared/types/json'
import { createLogger } from '../../logger'
import { createOrchestrationEngine } from './engine'
import { MemoryRunStore } from './memory-run-store'
import { parseOpenWagglePlan } from './planner'
import type {
  OpenWaggleOrchestrationPlan,
  OpenWaggleOrchestrationResult,
  OrchestrationRunRecord,
  OrchestrationTaskDefinition,
  OrchestrationTaskRetryPolicy,
  RunOpenWaggleOrchestrationInput,
  RunStore,
} from './types'
import { createOpenWaggleAgentWorkerAdapter } from './worker-adapter'

const BACKOFF_MS = 500
const JITTER_MS = 200

const logger = createLogger('orchestration')

const DEFAULT_TASK_RETRY: OrchestrationTaskRetryPolicy = {
  retries: 1,
  backoffMs: BACKOFF_MS,
  jitterMs: JITTER_MS,
}

export async function runOpenWaggleOrchestration(
  input: RunOpenWaggleOrchestrationInput,
): Promise<OpenWaggleOrchestrationResult> {
  const runStore = input.runStore ?? new MemoryRunStore()

  let planRaw: JsonValue
  try {
    planRaw = await input.planner.plan({ userPrompt: input.userPrompt })
  } catch (error) {
    return runSingleTaskFallback(
      input,
      runStore,
      `planner-error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let plan: OpenWaggleOrchestrationPlan
  try {
    plan = parseOpenWagglePlan(planRaw)
  } catch (error) {
    return runSingleTaskFallback(
      input,
      runStore,
      error instanceof Error ? error.message : String(error),
    )
  }

  const taskById = Object.fromEntries(plan.tasks.map((task) => [task.id, task] as const))

  const workerAdapter = createOpenWaggleAgentWorkerAdapter({
    executor: input.executor,
    taskById,
    maxContextTokens: input.maxContextTokens,
  })

  const engine = createOrchestrationEngine({
    workerAdapter,
    runStore,
    onEvent: input.onEvent,
  })

  const tasks: OrchestrationTaskDefinition[] = plan.tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    input: {
      title: task.title,
      prompt: task.prompt,
    },
    dependsOn: task.dependsOn,
    retry: DEFAULT_TASK_RETRY,
  }))

  const summary = await engine.run({
    runId: input.runId,
    tasks,
    maxParallelTasks: input.maxParallelTasks,
    signal: input.signal,
  })

  const run = await engine.getRun(summary.runId)
  if (!run) {
    throw new Error(`Run ${summary.runId} was not persisted`)
  }

  if (summary.status !== 'completed') {
    return {
      runId: summary.runId,
      usedFallback: false,
      text: '',
      runStatus: summary.status,
      run,
    }
  }

  let text: string
  try {
    text = await input.synthesizer.synthesize({
      userPrompt: input.userPrompt,
      plan,
      run,
    })
    if (!text.trim()) {
      logger.warn('synthesis returned empty output, concatenating task outputs', {
        runId: summary.runId,
      })
      text = concatenateOutputs(run)
    }
  } catch (error) {
    // Synthesis fallback: concatenate task outputs directly
    logger.warn('synthesis failed, concatenating outputs', {
      runId: summary.runId,
      error: error instanceof Error ? error.message : String(error),
    })
    text = concatenateOutputs(run)
  }

  return {
    runId: summary.runId,
    usedFallback: false,
    text,
    runStatus: summary.status,
    run,
  }
}

/**
 * When the planner fails or returns an unparseable plan, run a single general
 * task with the user's original prompt. This keeps us in orchestration mode
 * (with retry support) instead of falling back to classic agent entirely.
 */
async function runSingleTaskFallback(
  input: RunOpenWaggleOrchestrationInput,
  runStore: RunStore,
  reason: string,
): Promise<OpenWaggleOrchestrationResult> {
  const plan: OpenWaggleOrchestrationPlan = {
    tasks: [
      {
        id: 'fallback-task',
        kind: 'general',
        title: 'Direct response',
        prompt: input.userPrompt,
        needsConversationContext: true,
      },
    ],
  }

  const taskById = { 'fallback-task': plan.tasks[0] }
  const workerAdapter = createOpenWaggleAgentWorkerAdapter({
    executor: input.executor,
    taskById,
    maxContextTokens: input.maxContextTokens,
  })

  const engine = createOrchestrationEngine({
    workerAdapter,
    runStore,
    onEvent: input.onEvent,
  })

  const tasks: OrchestrationTaskDefinition[] = [
    {
      id: 'fallback-task',
      kind: 'general',
      input: { title: 'Direct response', prompt: input.userPrompt },
      retry: DEFAULT_TASK_RETRY,
    },
  ]

  let summary: Awaited<ReturnType<typeof engine.run>>
  try {
    summary = await engine.run({
      runId: input.runId,
      tasks,
      maxParallelTasks: 1,
      signal: input.signal,
    })
  } catch {
    // Last resort: fall back entirely
    return {
      runId: input.runId ?? 'fallback',
      usedFallback: true,
      fallbackReason: reason,
      text: input.userPrompt,
    }
  }

  const run = await engine.getRun(summary.runId)
  if (!run) {
    return {
      runId: input.runId ?? 'fallback',
      usedFallback: true,
      fallbackReason: reason,
      text: input.userPrompt,
    }
  }

  if (summary.status !== 'completed') {
    return {
      runId: summary.runId,
      usedFallback: true,
      fallbackReason: reason,
      text: '',
      runStatus: summary.status,
      run,
    }
  }

  const text = extractTaskOutputText(run, 'fallback-task')
  return {
    runId: summary.runId,
    usedFallback: false,
    text: text || concatenateOutputs(run),
    runStatus: summary.status,
    run,
  }
}

function extractTaskOutputText(run: OrchestrationRunRecord, taskId: string): string {
  const output = run.outputs[taskId]
  if (typeof output === 'string') return output
  if (output && typeof output === 'object' && 'text' in output) {
    return String(output.text)
  }
  return ''
}

function concatenateOutputs(run: OrchestrationRunRecord): string {
  const parts: string[] = []
  for (const taskId of run.taskOrder) {
    const text = extractTaskOutputText(run, taskId)
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}
