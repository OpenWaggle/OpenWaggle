import type {
  ScheduledTask,
  ScheduledTaskRejectionCode,
  ScheduledTaskRun,
  ScheduledTasksCommand,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import { SCHEDULED_TASK_RUN_PAGE_LIMIT } from '@shared/types/scheduled-task'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import type { OpenWaggleQueryOptions } from './query-options'

/**
 * Scheduled tasks (ADR 0057) live in the Session Host. The GUI polls the list while it is open,
 * since a task fires with no window event, and refreshes on focus so a returning user sees the
 * runs that happened meanwhile.
 */
const SCHEDULED_TASKS_REFRESH_INTERVAL_MS = 30_000

export const scheduledTasksQueryKeys = {
  all: ['scheduledTasks'] as const,
  list: () => ['scheduledTasks', 'list'] as const,
  detail: (taskId: string) => ['scheduledTasks', 'detail', taskId] as const,
  runs: (taskId: string) => ['scheduledTasks', 'runs', taskId] as const,
}

/** The Host refused a Scheduled tasks command; `message` is the Host's own explanation. */
export class ScheduledTaskRejectedError extends Error {
  readonly code: ScheduledTaskRejectionCode

  constructor(code: ScheduledTaskRejectionCode, message: string) {
    super(message)
    this.name = 'ScheduledTaskRejectedError'
    this.code = code
  }
}

type AcceptedOutcome = Exclude<ScheduledTasksOutcome, { readonly effect: 'rejected' }>

/** One `scheduled-tasks-v1` command; a Host rejection becomes a thrown, readable error. */
export async function executeScheduledTasksCommand(
  command: ScheduledTasksCommand,
  idempotencyKey?: string,
): Promise<AcceptedOutcome> {
  const outcome = await api.executeScheduledTasks(command, idempotencyKey)
  if (outcome.effect === 'rejected') {
    throw new ScheduledTaskRejectedError(outcome.code, outcome.message)
  }
  return outcome
}

function unexpectedOutcome(outcome: AcceptedOutcome): never {
  throw new Error(`Unexpected Scheduled tasks outcome: ${outcome.effect}`)
}

async function listScheduledTasks() {
  const outcome = await executeScheduledTasksCommand({ operation: 'list' })
  return outcome.effect === 'listed' ? outcome.tasks : unexpectedOutcome(outcome)
}

async function readScheduledTask(taskId: string) {
  const outcome = await executeScheduledTasksCommand({ operation: 'read', taskId })
  return outcome.effect === 'read' ? outcome.task : unexpectedOutcome(outcome)
}

async function listScheduledTaskRuns(taskId: string) {
  const outcome = await executeScheduledTasksCommand({
    operation: 'runs',
    taskId,
    limit: SCHEDULED_TASK_RUN_PAGE_LIMIT,
  })
  return outcome.effect === 'runs-listed' ? outcome.runs : unexpectedOutcome(outcome)
}

/**
 * Every task the user can see, in one shared cache entry: each surface (Right panel, Settings,
 * Session Summary, transcript rows, the shell monitor) narrows it client-side.
 */
export function scheduledTasksListQueryOptions(): OpenWaggleQueryOptions<
  readonly ScheduledTask[],
  Error,
  readonly ScheduledTask[],
  ReturnType<typeof scheduledTasksQueryKeys.list>
> {
  return queryOptions({
    queryKey: scheduledTasksQueryKeys.list(),
    queryFn: () => listScheduledTasks(),
    refetchInterval: SCHEDULED_TASKS_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function scheduledTaskDetailQueryOptions(
  taskId: string,
): OpenWaggleQueryOptions<
  ScheduledTask,
  Error,
  ScheduledTask,
  ReturnType<typeof scheduledTasksQueryKeys.detail>
> {
  return queryOptions({
    queryKey: scheduledTasksQueryKeys.detail(taskId),
    queryFn: () => readScheduledTask(taskId),
    refetchInterval: SCHEDULED_TASKS_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function scheduledTaskRunsQueryOptions(
  taskId: string,
): OpenWaggleQueryOptions<
  readonly ScheduledTaskRun[],
  Error,
  readonly ScheduledTaskRun[],
  ReturnType<typeof scheduledTasksQueryKeys.runs>
> {
  return queryOptions({
    queryKey: scheduledTasksQueryKeys.runs(taskId),
    queryFn: () => listScheduledTaskRuns(taskId),
    refetchInterval: SCHEDULED_TASKS_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}
