const SCHEDULED_TASK_RUN_KEY_PREFIX = 'scheduled-task-run:'
const WORK_MARKS = { person: 'person:', agents: 'agents:' } as const

/**
 * Whose work a Scheduled task run is: the person's when the person created the task (or asked for
 * this run with Run now), else the agents' or client profile's that made it or asked for it.
 */
export type ScheduledTaskRunWork = keyof typeof WORK_MARKS

/**
 * The Session Control request key of a Scheduled task run. The run's record holds the same key,
 * so the Host can tell a Run a task fired from one its owner started by hand. A task fires as its
 * owner, so the key also says whose work the run is; being part of the Run's own intent, that
 * survives the task being deleted.
 */
export function scheduledTaskRunKey(runId: string, work: ScheduledTaskRunWork) {
  return `${SCHEDULED_TASK_RUN_KEY_PREFIX}${WORK_MARKS[work]}${runId}`
}

/** Whether a request key is one a Scheduled task run sends (`scheduledTaskRunKey`). */
export function isScheduledTaskRunKey(key: string | undefined) {
  return key?.startsWith(SCHEDULED_TASK_RUN_KEY_PREFIX) === true
}

/**
 * Whose work a Scheduled task run key marks, or undefined for a key from before keys were marked
 * (or not a run's key at all).
 */
export function scheduledTaskRunWork(key: string | undefined): ScheduledTaskRunWork | undefined {
  if (!isScheduledTaskRunKey(key)) return undefined
  const rest = key?.slice(SCHEDULED_TASK_RUN_KEY_PREFIX.length) ?? ''
  if (rest.startsWith(WORK_MARKS.person)) return 'person'
  if (rest.startsWith(WORK_MARKS.agents)) return 'agents'
  return undefined
}
