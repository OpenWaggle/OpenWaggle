/** Scheduled task guidance in the full Hive rules, for a grant that reads or manages schedules. */
export const SCHEDULED_TASK_GUIDELINES = [
  'Create a Scheduled task (schedule_create) only when the user directly asks for recurring or scheduled work, or a project or skill instruction authorizes it. Finish monitoring already in progress within the current Run instead of scheduling it.',
  'A Heartbeat (scheduleKind heartbeat) delivers its prompt into one existing Session, this Session when sessionId is omitted; a Launch schedule (scheduleKind launch) starts a new root Session in projectPath each run. A Heartbeat fires at most every 5 minutes, a Launch schedule every 15.',
  'schedule times (daily at, rrule) are wall-clock times in the task timeZone, the machine zone by default; never convert them to UTC.',
  'Every Heartbeat needs a way to finish: give stopWhen (the outcome after which it stops, in plain words), endsAt or maxRuns; indefinite true only when the user wants it never to end.',
  'When a cheap shell command can tell whether there is anything to do (new CI failures, a changed file), give it as wakeIf: the Host runs it before each firing and skips the Run, with no model call, unless it exits non-zero or prints something on standard output.',
  'A Heartbeat Run reads runCount, consecutiveIdleRuns, stopWhen, remainingRuns and any wakeCheck output in its Run identity. If stopWhen is met or nothing is left to do, call schedule_update enabled:false and state why; end with schedule_outcome done, idle or acted. Idle runs in a row (3 by default, idlePauseAfter) pause it automatically.',
  'A Heartbeat may use its own cheaper model and thinking for its Runs (model, thinking). When a check does not need this Session’s context, a Launch schedule into a fresh Session is often cheaper.',
]

/**
 * Why a Session can lack the schedule capabilities, and what the user can do instead. It names no
 * other hive action, so a Worker is not pointed at actions it would be refused.
 */
export const SCHEDULES_WITHHELD_REASON =
  'A Worker never gets them. A top-level Session lacks them when its agent definition, or the agent or access profile that made it, did not have them. The user can still set the task up in the Scheduled panel or with openwaggle schedules, or ask a Session that has them.'
