/**
 * The key of the Session Control request a Scheduled task's firing sends. A task a Session agent
 * created runs as the agent's owner, often the person, so its key says whose work it is: the
 * Host's capacity rule must not take such a firing for the person's own (ADR 0030, amended
 * 2026-11-09).
 */
const RUN_KEY_PREFIX = 'scheduled-task-run:'
const AGENT_RUN_KEY_PREFIX = `${RUN_KEY_PREFIX}session-agent:`

export function scheduledTaskRunKey(
  runId: string,
  creatorKind: 'local-user' | 'profile' | 'session-agent',
) {
  return creatorKind === 'session-agent'
    ? `${AGENT_RUN_KEY_PREFIX}${runId}`
    : `${RUN_KEY_PREFIX}${runId}`
}

/** Whether a request key is a firing of a Scheduled task a Session agent created. */
export function isAgentScheduledRunKey(idempotencyKey: string | undefined) {
  return idempotencyKey?.startsWith(AGENT_RUN_KEY_PREFIX) === true
}
