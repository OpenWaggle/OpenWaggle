/**
 * The key of the Session Control request a Scheduled task's firing sends. A task runs as its
 * owner, often the person, whoever wrote its work, so its key says whether an agent's work fires:
 * a task a Session agent created or last rewrote, or a Run now an agent asked for. The Host's
 * capacity rule must not take such a firing for the person's own (ADR 0030, amended 2026-11-09).
 */
const RUN_KEY_PREFIX = 'scheduled-task-run:'
const AGENT_RUN_KEY_PREFIX = `${RUN_KEY_PREFIX}session-agent:`

export function scheduledTaskRunKey(runId: string, byAgent: boolean) {
  return byAgent ? `${AGENT_RUN_KEY_PREFIX}${runId}` : `${RUN_KEY_PREFIX}${runId}`
}

/** Whether a request key is a firing of an agent's work (`scheduledTaskRunKey`). */
export function isAgentScheduledRunKey(idempotencyKey: string | undefined) {
  return idempotencyKey?.startsWith(AGENT_RUN_KEY_PREFIX) === true
}
