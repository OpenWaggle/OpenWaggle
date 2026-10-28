import type { EvalTaskGroup } from './evaluate-agent-context-types'

/**
 * Aggregates evaluation runs per task and per group, and checks a candidate against a baseline
 * with the plan's acceptance rule: no task loses more than one pass out of its repetitions, no
 * group's total passes drop, and total tokens and cost go down.
 */
export interface EvalRunSummaryInput {
  readonly taskId: string
  readonly group: EvalTaskGroup
  readonly pass: boolean
  readonly totalTokens: number
  readonly modelCalls: number
  readonly toolSearchCalls: number
  readonly usage: { readonly costUsd: number }
}

export interface TaskSummary {
  readonly taskId: string
  readonly group: EvalTaskGroup
  readonly runs: number
  readonly passes: number
  readonly tokens: number
  readonly costUsd: number
  readonly modelCalls: number
  readonly toolSearchCalls: number
}

export const ALLOWED_TASK_PASS_DROP = 1

function addRun(previous: TaskSummary | undefined, run: EvalRunSummaryInput): TaskSummary {
  const base = previous ?? { taskId: run.taskId, group: run.group, runs: 0, passes: 0, tokens: 0, costUsd: 0, modelCalls: 0, toolSearchCalls: 0 }
  return {
    ...base,
    runs: base.runs + 1,
    passes: base.passes + (run.pass ? 1 : 0),
    tokens: base.tokens + run.totalTokens,
    costUsd: base.costUsd + run.usage.costUsd,
    modelCalls: base.modelCalls + run.modelCalls,
    toolSearchCalls: base.toolSearchCalls + run.toolSearchCalls,
  }
}

export function summarizeEvalRuns(runs: readonly EvalRunSummaryInput[]) {
  const byTask = new Map<string, TaskSummary>()
  for (const run of runs) byTask.set(run.taskId, addRun(byTask.get(run.taskId), run))
  const tasks = [...byTask.values()].sort((left, right) => left.taskId.localeCompare(right.taskId))
  const groups: Record<string, { runs: number; passes: number; tokens: number; costUsd: number }> = {}
  for (const task of tasks) {
    const group = (groups[task.group] ??= { runs: 0, passes: 0, tokens: 0, costUsd: 0 })
    group.runs += task.runs
    group.passes += task.passes
    group.tokens += task.tokens
    group.costUsd += task.costUsd
  }
  const totals = tasks.reduce(
    (sum, task) => ({ runs: sum.runs + task.runs, passes: sum.passes + task.passes, tokens: sum.tokens + task.tokens, costUsd: sum.costUsd + task.costUsd }),
    { runs: 0, passes: 0, tokens: 0, costUsd: 0 },
  )
  return { tasks, groups, totals }
}

export type EvalSummary = ReturnType<typeof summarizeEvalRuns>

export function compareWithBaseline(baseline: EvalSummary, candidate: EvalSummary) {
  const taskRegressions = candidate.tasks.flatMap((task) => {
    const before = baseline.tasks.find((entry) => entry.taskId === task.taskId)
    return before && task.passes < before.passes - ALLOWED_TASK_PASS_DROP
      ? [{ taskId: task.taskId, before: before.passes, after: task.passes }]
      : []
  })
  const groupRegressions = Object.entries(candidate.groups).flatMap(([group, totals]) => {
    const before = baseline.groups[group]
    return before && totals.passes < before.passes ? [{ group, before: before.passes, after: totals.passes }] : []
  })
  const tokensDown = candidate.totals.tokens < baseline.totals.tokens
  const costDown = candidate.totals.costUsd < baseline.totals.costUsd
  return {
    accepted: taskRegressions.length === 0 && groupRegressions.length === 0 && tokensDown && costDown,
    taskRegressions,
    groupRegressions,
    tokens: { before: baseline.totals.tokens, after: candidate.totals.tokens, down: tokensDown },
    costUsd: { before: baseline.totals.costUsd, after: candidate.totals.costUsd, down: costDown },
  }
}
