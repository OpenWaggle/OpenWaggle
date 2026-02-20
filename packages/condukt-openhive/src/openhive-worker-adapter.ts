import type { WorkerAdapter } from '../../condukt-ai/src/index.js'
import type { OpenHivePlannedTask, OpenHiveTaskExecutor } from './types'
import { resolveChildContextHeuristic } from './context-heuristic'

interface OpenHiveWorkerAdapterOptions {
  readonly executor: OpenHiveTaskExecutor
  readonly taskById: Readonly<Record<string, OpenHivePlannedTask>>
  readonly maxContextTokens?: number
}

export function createOpenHiveAgentWorkerAdapter(
  options: OpenHiveWorkerAdapterOptions,
): WorkerAdapter {
  return {
    async executeTask(task, context) {
      const plannedTask = options.taskById[task.id]
      if (!plannedTask) {
        throw new Error(`Missing planned task metadata for ${task.id}`)
      }

      const heuristic = resolveChildContextHeuristic({
        taskKind: plannedTask.kind,
        needsConversationContext: plannedTask.needsConversationContext,
        maxContextTokens: options.maxContextTokens,
      })

      const output = await options.executor.execute({
        task: plannedTask,
        orchestrationTask: task,
        includeConversationSummary: heuristic.includeConversationSummary,
        maxContextTokens: heuristic.maxContextTokens,
        dependencyOutputs: context.dependencyOutputs,
        signal: context.signal,
      })

      return { output }
    },
  }
}
