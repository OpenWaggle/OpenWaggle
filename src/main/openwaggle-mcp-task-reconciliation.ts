import { SessionId } from '@shared/types/brand'
import type { SessionDelegationState } from '@shared/types/session'
import { isActiveTaskStatus, recoverStaleTask } from './openwaggle-mcp-task-leases'
import { projectTaskDelegationState, terminalDelegationState } from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore, ServerTaskRecord } from './openwaggle-mcp-task-store'

interface ReconcileProfileTasksInput {
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly store: OpenWaggleMcpTaskStore
}

const TASK_PROJECTION_MAX_ATTEMPTS = 3

function isNewerTask(candidate: ServerTaskRecord, current: ServerTaskRecord) {
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt
  return candidate.id.localeCompare(current.id) > 0
}

export function authoritativeTaskForSession(tasks: readonly ServerTaskRecord[], sessionId: string) {
  let authoritative: ServerTaskRecord | null = null
  for (const task of tasks) {
    if (task.sessionId !== sessionId) continue
    if (!authoritative || isNewerTask(task, authoritative)) authoritative = task
  }
  return authoritative
}

function authoritativeTasksBySession(tasks: readonly ServerTaskRecord[]) {
  const authoritative = new Map<string, ServerTaskRecord>()
  for (const task of tasks) {
    if (!task.sessionId) continue
    const current = authoritative.get(task.sessionId)
    if (!current || isNewerTask(task, current)) authoritative.set(task.sessionId, task)
  }
  return authoritative.values()
}

function delegationStateForTask(task: ServerTaskRecord) {
  return isActiveTaskStatus(task.status) ? 'working' : terminalDelegationState(task.status)
}

function acknowledgeProjectedState(
  input: Pick<ReconcileProfileTasksInput, 'store'>,
  taskId: string,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  return input.store.update((tasks) => {
    const authoritative = authoritativeTaskForSession(tasks, sessionId)
    if (authoritative?.id !== taskId || delegationStateForTask(authoritative) !== state) {
      return { tasks, result: false }
    }
    return {
      tasks: tasks.map((task) =>
        task.id === taskId ? { ...task, projectedDelegationState: state } : task,
      ),
      result: true,
    }
  })
}

export async function projectTaskStateIfAuthoritative(
  input: Pick<ReconcileProfileTasksInput, 'services' | 'store'>,
  taskId: string,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  const initial = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
  if (initial?.id !== taskId || delegationStateForTask(initial) !== state) return false
  for (let attempt = 0; attempt < TASK_PROJECTION_MAX_ATTEMPTS; attempt += 1) {
    const before = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
    if (!before) return false
    const projectedState = delegationStateForTask(before)
    const succeeded = await projectTaskDelegationState(input.services, sessionId, projectedState)
    if (!succeeded) continue
    const projectedRequestedState = before.id === taskId && projectedState === state
    if (await acknowledgeProjectedState(input, before.id, sessionId, projectedState)) {
      return projectedRequestedState
    }
  }
  return false
}

export async function reconcileOpenWaggleProfileTasks(input: ReconcileProfileTasksInput) {
  const reconciliation = await input.store.update((tasks) => {
    const reconciled = tasks.map((task) => {
      if (task.callerProfile !== input.profile) return task
      return recoverStaleTask(task, input.now)
    })
    const pending = [...authoritativeTasksBySession(reconciled)].flatMap((task) => {
      if (task.callerProfile !== input.profile || !task.sessionId) return []
      const state = delegationStateForTask(task)
      return task.projectedDelegationState === state
        ? []
        : [{ taskId: task.id, sessionId: SessionId(task.sessionId), state }]
    })
    return { tasks: reconciled, result: { pending, tasks: reconciled } }
  })
  await Promise.all(
    reconciliation.pending.map((task) =>
      projectTaskStateIfAuthoritative(input, task.taskId, task.sessionId, task.state),
    ),
  )
  return reconciliation.tasks
}
