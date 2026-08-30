import { SessionId } from '@shared/types/brand'
import { recoverStaleTask } from './openwaggle-mcp-task-leases'
import { projectTaskDelegationState, terminalDelegationState } from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import { isTerminalTaskStatus, type OpenWaggleMcpTaskStore } from './openwaggle-mcp-task-store'

interface ReconcileProfileTasksInput {
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly store: OpenWaggleMcpTaskStore
}

export async function reconcileOpenWaggleProfileTasks(input: ReconcileProfileTasksInput) {
  const reconciliation = await input.store.update((tasks) => {
    const reconciled = tasks.map((task) => {
      if (task.callerProfile !== input.profile) return task
      return recoverStaleTask(task, input.now)
    })
    const pending = reconciled.flatMap((task) => {
      if (
        task.callerProfile !== input.profile ||
        !task.sessionId ||
        !isTerminalTaskStatus(task.status)
      ) {
        return []
      }
      const state = terminalDelegationState(task.status)
      return task.projectedDelegationState === state
        ? []
        : [{ taskId: task.id, sessionId: SessionId(task.sessionId), state }]
    })
    return { tasks: reconciled, result: { pending, tasks: reconciled } }
  })
  const projected = (
    await Promise.all(
      reconciliation.pending.map(async (task) => ({
        ...task,
        succeeded: await projectTaskDelegationState(input.services, task.sessionId, task.state),
      })),
    )
  ).filter(({ succeeded }) => succeeded)
  if (projected.length > 0) {
    const stateByTaskId = new Map(projected.map(({ taskId, state }) => [taskId, state]))
    await input.store.update((tasks) => ({
      tasks: tasks.map((task) => {
        const state = stateByTaskId.get(task.id)
        return state &&
          isTerminalTaskStatus(task.status) &&
          terminalDelegationState(task.status) === state
          ? { ...task, projectedDelegationState: state }
          : task
      }),
      result: true,
    }))
  }
  return reconciliation.tasks
}
