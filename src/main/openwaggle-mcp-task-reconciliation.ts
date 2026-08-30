import { SessionId } from '@shared/types/brand'
import { recoverStaleTask } from './openwaggle-mcp-task-leases'
import { projectTaskDelegationState, terminalDelegationState } from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore, ServerTaskRecord } from './openwaggle-mcp-task-store'

interface ReconcileProfileTasksInput {
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly store: OpenWaggleMcpTaskStore
}

export async function reconcileOpenWaggleProfileTasks(input: ReconcileProfileTasksInput) {
  const reconciliation = await input.store.update((tasks) => {
    const recovered: Array<{
      readonly sessionId: SessionId
      readonly status: ServerTaskRecord['status']
    }> = []
    const reconciled = tasks.map((task) => {
      if (task.callerProfile !== input.profile) return task
      const next = recoverStaleTask(task, input.now)
      if (next.status !== task.status && next.sessionId) {
        recovered.push({ sessionId: SessionId(next.sessionId), status: next.status })
      }
      return next
    })
    return { tasks: reconciled, result: { recovered, tasks: reconciled } }
  })
  await Promise.all(
    reconciliation.recovered.map((task) =>
      projectTaskDelegationState(
        input.services,
        task.sessionId,
        terminalDelegationState(task.status),
      ),
    ),
  )
  return reconciliation.tasks
}
