import * as Effect from 'effect/Effect'
import { advanceScheduledTask } from '../application/scheduled-task-bookkeeping'
import { scheduledTaskHooks } from '../application/scheduled-task-hooks'
import { ScheduledTaskRepository } from '../ports/scheduled-task-repository'

const INTERRUPTED_MESSAGES = {
  notSent: 'The Session Host stopped before this run was sent; nothing reached the Session.',
  refused: 'The Session Host stopped while this run was being sent, and the request was refused.',
}

/**
 * Settles runs a previous Host stopped while sending. A firing Session Control recorded moves its
 * task on, so the next tick never fires the same firing again under a new key; one it never
 * recorded leaves the task due, and the next tick catches up as it would after any downtime.
 */
export const settleInterruptedFirings = Effect.gen(function* () {
  const repository = yield* ScheduledTaskRepository
  const interrupted = yield* repository.settleInterruptedRuns(INTERRUPTED_MESSAGES)
  const now = scheduledTaskHooks().now()
  for (const run of interrupted) {
    if (!run.delivered) continue
    const record = yield* repository.get(run.taskId)
    if (!record) continue
    yield* advanceScheduledTask(record, {
      firedNominalAt: run.trigger === 'run-now' ? null : run.nominalAt,
      started: run.started,
      now,
    })
  }
})
