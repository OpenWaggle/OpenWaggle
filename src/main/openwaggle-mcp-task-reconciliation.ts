import { SessionId } from '@shared/types/brand'
import type { SessionDelegationState } from '@shared/types/session'
import { isActiveTaskStatus, recoverStaleTask } from './openwaggle-mcp-task-leases'
import { projectTaskDelegationState, terminalDelegationState } from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import {
  isTerminalTaskStatus,
  type OpenWaggleMcpTaskStore,
  type ServerTaskRecord,
} from './openwaggle-mcp-task-store'

interface ReconcileProfileTasksInput {
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly store: OpenWaggleMcpTaskStore
}

const TASK_PROJECTION_CORRECTION_MAX_ATTEMPTS = 3

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

async function restoreAuthoritativeTaskProjection(
  input: Pick<ReconcileProfileTasksInput, 'services' | 'store'>,
  sessionId: SessionId,
) {
  for (let attempt = 0; attempt < TASK_PROJECTION_CORRECTION_MAX_ATTEMPTS; attempt += 1) {
    const authoritative = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
    if (!authoritative) return false
    const succeeded = await projectTaskDelegationState(
      input.services,
      sessionId,
      delegationStateForTask(authoritative),
    )
    if (succeeded) return true
  }
  return false
}

export async function projectTaskStateIfAuthoritative(
  input: Pick<ReconcileProfileTasksInput, 'services' | 'store'>,
  taskId: string,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  const before = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
  if (before?.id !== taskId) return false
  const succeeded = await projectTaskDelegationState(input.services, sessionId, state)
  if (!succeeded) return false
  const after = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
  if (!after) return true
  if (after.id === taskId && delegationStateForTask(after) === state) return true
  await restoreAuthoritativeTaskProjection(input, sessionId)
  return false
}

export async function reconcileOpenWaggleProfileTasks(input: ReconcileProfileTasksInput) {
  const reconciliation = await input.store.update((tasks) => {
    const reconciled = tasks.map((task) => {
      if (task.callerProfile !== input.profile) return task
      return recoverStaleTask(task, input.now)
    })
    const pending = [...authoritativeTasksBySession(reconciled)].flatMap((task) => {
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
        succeeded: await projectTaskStateIfAuthoritative(
          input,
          task.taskId,
          task.sessionId,
          task.state,
        ),
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
