import { resolveChildContextHeuristic } from './context-heuristic'
import type { OpenHivePlannedTask, OpenHiveTaskExecutor, WorkerAdapter } from './types'

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
        reportProgress: context.reportProgress,
      })

      return { output }
    },
  }
}
