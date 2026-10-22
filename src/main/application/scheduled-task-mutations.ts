import type {
  ScheduledTaskInput,
  ScheduledTaskKind,
  ScheduledTaskPatch,
  ScheduledTaskRejectionCode,
  ScheduledTasksOutcome,
  ScheduledTaskTarget,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { validateTaskSchedule } from '../domain/scheduled-tasks/task-schedule'
import {
  type ScheduledTaskRecord,
  type ScheduledTaskRecordChanges,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { scheduledTaskHooks } from './scheduled-task-hooks'
import { nextFiringOf, presentScheduledTask } from './scheduled-task-presentation'
import type { ScheduledTaskPrincipal } from './scheduled-task-principal'
import { authorizeScheduledTaskTarget } from './scheduled-task-target-authorization'

/** Tasks one owner may keep; scheduling is recurring spend, so a runaway agent stops here. */
export const SCHEDULED_TASKS_PER_OWNER_LIMIT = 200

export function rejectedOutcome(code: ScheduledTaskRejectionCode, message: string) {
  return { effect: 'rejected', code, message } satisfies ScheduledTasksOutcome
}

function defaultPolicy(kind: ScheduledTaskKind) {
  return kind === 'heartbeat' ? ('failures-only' as const) : ('every-run' as const)
}

/** The target's project, after checking the caller could send its run request by hand. */
function admitTarget(principal: ScheduledTaskPrincipal, target: ScheduledTaskTarget) {
  return Effect.gen(function* () {
    let projectPath: string | null = target.kind === 'launch' ? target.projectPath : null
    if (target.kind === 'heartbeat') {
      const targets = yield* SessionAuthorizationTargetRepository
      const resolved = yield* targets.resolve(target.sessionId).pipe(Effect.option)
      if (resolved._tag === 'None') {
        return rejectedOutcome('target_not_found', 'That Session was not found.')
      }
      projectPath = resolved.value.projectPath
    }
    const authorization = yield* authorizeScheduledTaskTarget(principal.caller, target)
    if (!authorization.authorized) {
      return rejectedOutcome(authorization.code, authorization.message)
    }
    return { effect: 'admitted', projectPath } as const
  })
}

function scheduleRejection(
  kind: ScheduledTaskKind,
  fields: Pick<ScheduledTaskRecord, 'schedule' | 'timeZone'>,
  now: number,
) {
  const validation = validateTaskSchedule({ kind, ...fields, now })
  return validation.ok ? null : rejectedOutcome(validation.code, validation.message)
}

function plannedFields(record: ScheduledTaskRecord, now: number) {
  const next = record.enabled ? nextFiringOf(record, now) : null
  return { nextRunAt: next?.runAt ?? null, nextNominalAt: next?.nominalAt ?? null }
}

export function createScheduledTask(input: {
  readonly principal: ScheduledTaskPrincipal
  readonly task: ScheduledTaskInput
  readonly idempotencyKey?: string
}) {
  return Effect.gen(function* () {
    const hooks = scheduledTaskHooks()
    const repository = yield* ScheduledTaskRepository
    const { principal, task } = input
    if (input.idempotencyKey) {
      const replayed = yield* repository.findByCreateKey(principal.ownerKey, input.idempotencyKey)
      if (replayed) {
        return { effect: 'created', task: presentScheduledTask(replayed, null) } as const
      }
    }
    if ((yield* repository.countForOwner(principal.ownerKey)) >= SCHEDULED_TASKS_PER_OWNER_LIMIT) {
      return rejectedOutcome(
        'task_limit_reached',
        `You already have ${String(SCHEDULED_TASKS_PER_OWNER_LIMIT)} Scheduled tasks.`,
      )
    }
    const now = hooks.now()
    const kind = task.target.kind
    const timeZone = task.timeZone ?? hooks.defaultTimeZone()
    const scheduleRefusal = scheduleRejection(kind, { schedule: task.schedule, timeZone }, now)
    if (scheduleRefusal) return scheduleRefusal
    const admission = yield* admitTarget(principal, task.target)
    if (admission.effect === 'rejected') return admission
    const draft: ScheduledTaskRecord = {
      id: hooks.newId(),
      ownerKey: principal.ownerKey,
      creatorCallerId: principal.creatorCallerId,
      creator: principal.creator,
      creatorWorkingDirectory: principal.workingDirectory,
      kind,
      name: task.name.trim(),
      prompt: task.prompt,
      enabled: task.enabled,
      schedule: task.schedule,
      timeZone,
      anchorAt: now,
      endsAt: task.endsAt ?? null,
      maxRuns: task.maxRuns ?? null,
      target: task.target,
      projectPath: admission.projectPath,
      notificationPolicy: task.notificationPolicy ?? defaultPolicy(kind),
      attention: null,
      nextRunAt: null,
      nextNominalAt: null,
      waitingSince: null,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    const planned = { ...draft, ...plannedFields(draft, now) }
    if (planned.enabled && planned.nextRunAt === null) {
      return rejectedOutcome('schedule_ended', 'This schedule has no firing left.')
    }
    const stored = yield* repository.insert({
      ...planned,
      createIdempotencyKey: input.idempotencyKey ?? null,
    })
    hooks.tasksChanged()
    return { effect: 'created', task: presentScheduledTask(stored, null) } as const
  })
}

function targetChangeRefusal(current: ScheduledTaskRecord, target: ScheduledTaskTarget) {
  if (target.kind !== current.kind) {
    return rejectedOutcome(
      'kind_change_not_allowed',
      'A Heartbeat cannot become a Launch schedule, or the other way round.',
    )
  }
  if (
    target.kind === 'heartbeat' &&
    current.target.kind === 'heartbeat' &&
    target.sessionId !== current.target.sessionId
  ) {
    return rejectedOutcome(
      'target_session_change_not_allowed',
      'A Heartbeat keeps its Session; create a new one for another Session.',
    )
  }
  return null
}

function scheduleChanged(current: ScheduledTaskRecord, patch: ScheduledTaskPatch) {
  return (
    (patch.schedule !== undefined &&
      JSON.stringify(patch.schedule) !== JSON.stringify(current.schedule)) ||
    (patch.timeZone !== undefined && patch.timeZone !== current.timeZone) ||
    (patch.endsAt !== undefined && patch.endsAt !== current.endsAt) ||
    (patch.maxRuns !== undefined && patch.maxRuns !== current.maxRuns)
  )
}

/** The content a patch sets; an omitted field keeps its value. */
function contentFields(patch: ScheduledTaskPatch) {
  return {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.target !== undefined ? { target: patch.target } : {}),
    ...(patch.notificationPolicy !== undefined
      ? { notificationPolicy: patch.notificationPolicy }
      : {}),
  }
}

/** The schedule a patch sets. */
function scheduleFields(patch: ScheduledTaskPatch) {
  return {
    ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
    ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
    ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
    ...(patch.maxRuns !== undefined ? { maxRuns: patch.maxRuns } : {}),
  }
}

function mergedRecord(current: ScheduledTaskRecord, patch: ScheduledTaskPatch, now: number) {
  const rescheduled = scheduleChanged(current, patch)
  const enabling = patch.enabled === true && !current.enabled
  const merged: ScheduledTaskRecord = {
    ...current,
    ...contentFields(patch),
    ...scheduleFields(patch),
    ...(rescheduled ? { anchorAt: now } : {}),
    // Turning a task back on clears what stopped it; the next run checks again.
    ...(enabling ? { attention: null } : {}),
    updatedAt: Math.max(now, current.updatedAt + 1),
  }
  const replan = rescheduled || enabling || patch.enabled === false
  return replan ? { ...merged, ...plannedFields(merged, now), waitingSince: null } : merged
}

function recordChanges(record: ScheduledTaskRecord): ScheduledTaskRecordChanges {
  return {
    name: record.name,
    prompt: record.prompt,
    enabled: record.enabled,
    schedule: record.schedule,
    timeZone: record.timeZone,
    anchorAt: record.anchorAt,
    endsAt: record.endsAt,
    maxRuns: record.maxRuns,
    target: record.target,
    projectPath: record.projectPath,
    notificationPolicy: record.notificationPolicy,
    attention: record.attention,
    nextRunAt: record.nextRunAt,
    nextNominalAt: record.nextNominalAt,
    waitingSince: record.waitingSince,
    updatedAt: record.updatedAt,
  }
}

export function updateScheduledTask(input: {
  readonly principal: ScheduledTaskPrincipal
  readonly current: ScheduledTaskRecord
  readonly patch: ScheduledTaskPatch
}) {
  return Effect.gen(function* () {
    const hooks = scheduledTaskHooks()
    const repository = yield* ScheduledTaskRepository
    const { current, patch, principal } = input
    const now = hooks.now()
    if (patch.target) {
      const refusal = targetChangeRefusal(current, patch.target)
      if (refusal) return refusal
    }
    const merged = mergedRecord(current, patch, now)
    if (scheduleChanged(current, patch)) {
      const refusal = scheduleRejection(merged.kind, merged, now)
      if (refusal) return refusal
    }
    let projectPath = merged.projectPath
    if (patch.target) {
      const admission = yield* admitTarget(principal, patch.target)
      if (admission.effect === 'rejected') return admission
      projectPath = admission.projectPath
    }
    if (merged.enabled && merged.nextRunAt === null) {
      return rejectedOutcome('schedule_ended', 'This schedule has no firing left.')
    }
    const stored = yield* repository.update(
      current.id,
      current.updatedAt,
      recordChanges({ ...merged, projectPath }),
    )
    if (!stored) {
      return rejectedOutcome('task_not_found', 'The task changed or was deleted; try again.')
    }
    hooks.tasksChanged()
    const lastRuns = yield* repository.lastRuns([stored.id])
    return {
      effect: 'updated',
      task: presentScheduledTask(stored, lastRuns.get(stored.id) ?? null),
    } as const
  })
}
