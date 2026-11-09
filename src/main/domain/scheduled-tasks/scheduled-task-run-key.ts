const SCHEDULED_TASK_RUN_KEY_PREFIX = 'scheduled-task-run:'
const AGENTS_WORK_MARK = 'agents:'

/**
 * Whose work a Scheduled task run is: the person's when the person created the task (or asked for
 * this run with Run now), else the agents' or client profile's that made it or asked for it.
 */
export type ScheduledTaskRunWork = 'person' | 'agents'

/**
 * The Session Control request key of a Scheduled task run. The run's record holds the same key,
 * so the Host can tell a Run a task fired from one its owner started by hand. A task fires as its
 * owner, so the key also says whose work the run is; being part of the Run's own intent, that
 * survives the task being deleted.
 */
export function scheduledTaskRunKey(runId: string, work: ScheduledTaskRunWork = 'person') {
  const mark = work === 'agents' ? AGENTS_WORK_MARK : ''
  return `${SCHEDULED_TASK_RUN_KEY_PREFIX}${mark}${runId}`
}

/** Whether a request key is one a Scheduled task run sends (`scheduledTaskRunKey`). */
export function isScheduledTaskRunKey(key: string | undefined) {
  return key?.startsWith(SCHEDULED_TASK_RUN_KEY_PREFIX) === true
}

/** Whether a Scheduled task run key marks agents' work (keys from before the mark carry none). */
export function isAgentsScheduledTaskRunKey(key: string | undefined) {
  return key?.startsWith(`${SCHEDULED_TASK_RUN_KEY_PREFIX}${AGENTS_WORK_MARK}`) === true
}
