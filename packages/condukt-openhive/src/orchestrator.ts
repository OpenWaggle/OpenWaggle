import {
  createOrchestrationEngine,
  MemoryRunStore,
  type OrchestrationTaskDefinition,
} from '../../condukt-ai/src/index.js'
import { parseOpenHivePlan } from './planner'
import { createOpenHiveAgentWorkerAdapter } from './openhive-worker-adapter'
import type { OpenHiveOrchestrationResult, RunOpenHiveOrchestrationInput } from './types'

export async function runOpenHiveOrchestration(
  input: RunOpenHiveOrchestrationInput,
): Promise<OpenHiveOrchestrationResult> {
  const mode = input.mode ?? 'auto-fallback'
  const runStore = new MemoryRunStore()

  let planRaw: unknown
  try {
    planRaw = await input.planner.plan({ userPrompt: input.userPrompt })
  } catch (error) {
    if (mode === 'auto-fallback') {
      return {
        runId: input.runId ?? 'fallback',
        usedFallback: true,
        fallbackReason: `planner-error: ${error instanceof Error ? error.message : String(error)}`,
        text: input.userPrompt,
      }
    }
    throw error
  }

  let plan
  try {
    plan = parseOpenHivePlan(planRaw)
  } catch (error) {
    if (mode === 'auto-fallback') {
      return {
        runId: input.runId ?? 'fallback',
        usedFallback: true,
        fallbackReason: error instanceof Error ? error.message : String(error),
        text: input.userPrompt,
      }
    }
    throw error
  }

  const taskById = Object.fromEntries(plan.tasks.map((task) => [task.id, task] as const))

  const workerAdapter = createOpenHiveAgentWorkerAdapter({
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

  const text = await input.synthesizer.synthesize({
    userPrompt: input.userPrompt,
    plan,
    run,
  })

  return {
    runId: summary.runId,
    usedFallback: false,
    text,
    runStatus: summary.status,
    run,
  }
}
