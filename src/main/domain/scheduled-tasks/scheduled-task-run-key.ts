const SCHEDULED_TASK_RUN_KEY_PREFIX = 'scheduled-task-run:'

/**
 * The Session Control request key of a Scheduled task run. The run's record holds the same key,
 * so the Host can tell a Run a task fired from one its owner started by hand.
 */
export function scheduledTaskRunKey(runId: string) {
  return `${SCHEDULED_TASK_RUN_KEY_PREFIX}${runId}`
}

/** Whether a request key is one a Scheduled task run sends (`scheduledTaskRunKey`). */
export function isScheduledTaskRunKey(key: string | undefined) {
  return key?.startsWith(SCHEDULED_TASK_RUN_KEY_PREFIX) === true
}
