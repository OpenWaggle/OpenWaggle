import { resolveChildContextHeuristic } from './context-heuristic'
import type { OpenWagglePlannedTask, OpenWaggleTaskExecutor, WorkerAdapter } from './types'

interface OpenWaggleWorkerAdapterOptions {
  readonly executor: OpenWaggleTaskExecutor
  readonly taskById: Readonly<Record<string, OpenWagglePlannedTask>>
  readonly maxContextTokens?: number
}

export function createOpenWaggleAgentWorkerAdapter(
  options: OpenWaggleWorkerAdapterOptions,
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
