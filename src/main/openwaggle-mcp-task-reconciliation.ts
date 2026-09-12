import { SessionId } from '@shared/types/brand'
import type { SessionDelegationState } from '@shared/types/session'
import { isActiveTaskStatus, recoverStaleTask } from './openwaggle-mcp-task-leases'
import {
  establishTaskLineage,
  projectTaskDelegationState,
  terminalDelegationState,
} from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore, ServerTaskRecord } from './openwaggle-mcp-task-store'

interface ReconcileProfileTasksInput {
  readonly ensureSessionMetadata?: (task: ServerTaskRecord, sessionId: SessionId) => Promise<void>
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

function requiresSessionLinkageProjection(task: ServerTaskRecord) {
  return task.ownsSession === true || task.parentSessionId !== undefined
}

function invalidateProjectedState(task: ServerTaskRecord) {
  const { projectedDelegationState: _projectedDelegationState, ...unacknowledged } = task
  return unacknowledged
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
      return {
        tasks:
          authoritative?.projectedDelegationState === undefined
            ? tasks
            : tasks.map((task) =>
                task.id === authoritative.id ? invalidateProjectedState(task) : task,
              ),
        result: false,
      }
    }
    return {
      tasks: tasks.map((task) =>
        task.id === taskId ? { ...task, projectedDelegationState: state } : task,
      ),
      result: true,
    }
  })
}

async function ensureTaskSessionLinkage(
  input: Pick<ReconcileProfileTasksInput, 'ensureSessionMetadata' | 'services'>,
  task: ServerTaskRecord,
  sessionId: SessionId,
) {
  try {
    // Parentage is the durable Hive identity and must survive metadata setup failures. Both
    // operations are idempotent, so an interrupted process can safely retry them on recovery.
    await establishTaskLineage(input.services, task, sessionId)
    await input.ensureSessionMetadata?.(task, sessionId)
    return true
  } catch {
    return false
  }
}

async function projectTaskStateIfAuthoritativeUnlocked(
  input: Pick<ReconcileProfileTasksInput, 'ensureSessionMetadata' | 'services' | 'store'>,
  taskId: string,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  const initial = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
  if (
    initial?.id !== taskId ||
    delegationStateForTask(initial) !== state ||
    !requiresSessionLinkageProjection(initial)
  ) {
    return false
  }
  for (let attempt = 0; attempt < TASK_PROJECTION_MAX_ATTEMPTS; attempt += 1) {
    const before = authoritativeTaskForSession(await input.store.readTasks(), sessionId)
    if (!before) return false
    const projectedState = delegationStateForTask(before)
    if (!(await ensureTaskSessionLinkage(input, before, sessionId))) continue
    if (!before.parentSessionId) {
      const projectedRequestedState = before.id === taskId && projectedState === state
      if (await acknowledgeProjectedState(input, before.id, sessionId, projectedState)) {
        return projectedRequestedState
      }
      continue
    }
    const succeeded = await projectTaskDelegationState(input.services, sessionId, projectedState)
    if (!succeeded) continue
    const projectedRequestedState = before.id === taskId && projectedState === state
    if (await acknowledgeProjectedState(input, before.id, sessionId, projectedState)) {
      return projectedRequestedState
    }
  }
  return false
}

export function projectTaskStateIfAuthoritative(
  input: Pick<ReconcileProfileTasksInput, 'ensureSessionMetadata' | 'services' | 'store'>,
  taskId: string,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  return input.store.withProjectionLock(() =>
    projectTaskStateIfAuthoritativeUnlocked(input, taskId, sessionId, state),
  )
}

async function reconcileOpenWaggleProfileTasksUnlocked(input: ReconcileProfileTasksInput) {
  const reconciliation = await input.store.update((tasks) => {
    const reconciled = tasks.map((task) => {
      if (task.callerProfile !== input.profile) return task
      return recoverStaleTask(task, input.now)
    })
    const pending = [...authoritativeTasksBySession(reconciled)].flatMap((task) => {
      if (task.callerProfile !== input.profile || !task.sessionId) return []
      if (!requiresSessionLinkageProjection(task)) return []
      const state = delegationStateForTask(task)
      return task.projectedDelegationState === state
        ? []
        : [{ taskId: task.id, sessionId: SessionId(task.sessionId), state }]
    })
    return { tasks: reconciled, result: { pending, tasks: reconciled } }
  })
  await Promise.all(
    reconciliation.pending.map((task) =>
      projectTaskStateIfAuthoritativeUnlocked(input, task.taskId, task.sessionId, task.state),
    ),
  )
  return reconciliation.tasks
}

export function reconcileOpenWaggleProfileTasks(input: ReconcileProfileTasksInput) {
  return input.store.withProjectionLock(() => reconcileOpenWaggleProfileTasksUnlocked(input))
}
