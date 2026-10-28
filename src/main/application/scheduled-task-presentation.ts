import {
  planNextFiring,
  type ScheduleDefinition,
} from '@shared/domain/scheduled-tasks/task-schedule'
import type {
  HeartbeatSettings,
  HeartbeatWakeCheck,
  ScheduledTask,
  ScheduledTaskRun,
} from '@shared/types/scheduled-task'
import type {
  ScheduledTaskRecord,
  StoredHeartbeatWakeCheck,
} from '../ports/scheduled-task-repository'

export function scheduleDefinitionOf(
  record: Pick<ScheduledTaskRecord, 'id' | 'schedule' | 'timeZone' | 'anchorAt' | 'endsAt'>,
): ScheduleDefinition {
  return {
    taskId: record.id,
    schedule: record.schedule,
    timeZone: record.timeZone,
    anchorAt: record.anchorAt,
    endsAt: record.endsAt,
  }
}

/**
 * The next firing of an enabled task after `after`. A task whose schedule or run count has run
 * out has none, and is disabled by whoever finds that (ADR 0057: it disables itself).
 */
export function nextFiringOf(
  record: Pick<
    ScheduledTaskRecord,
    'id' | 'schedule' | 'timeZone' | 'anchorAt' | 'endsAt' | 'maxRuns' | 'runCount'
  >,
  after: number,
) {
  if (record.maxRuns !== null && record.runCount >= record.maxRuns) return null
  return planNextFiring(scheduleDefinitionOf(record), after)
}

/** Whether the user approved this exact command, or the Host holds the Heartbeat for it. */
export function wakeCheckApproval(wakeCheck: StoredHeartbeatWakeCheck) {
  if (wakeCheck.approvedCommand === wakeCheck.command) return 'approved' as const
  return wakeCheck.pendingSince === null ? ('not-required' as const) : ('pending' as const)
}

function presentWakeCheck(wakeCheck: StoredHeartbeatWakeCheck | null): HeartbeatWakeCheck | null {
  if (!wakeCheck) return null
  const approval = wakeCheckApproval(wakeCheck)
  return {
    command: wakeCheck.command,
    onFailure: wakeCheck.onFailure,
    approval,
    pendingSince: approval === 'pending' ? wakeCheck.pendingSince : null,
  }
}

function presentHeartbeat(record: ScheduledTaskRecord): HeartbeatSettings | null {
  if (record.kind !== 'heartbeat') return null
  return {
    stopWhen: record.stopWhen,
    indefinite: record.indefinite,
    idlePauseAfter: record.idlePauseAfter,
    wakeCheck: presentWakeCheck(record.wakeCheck),
    consecutiveIdleRuns: record.consecutiveIdleRuns,
    autoPause: record.autoPause,
  }
}

export function presentScheduledTask(
  record: ScheduledTaskRecord,
  lastRun: ScheduledTaskRun | null,
  recentSessionIds: readonly string[] = [],
): ScheduledTask {
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    kind: record.kind,
    enabled: record.enabled,
    schedule: record.schedule,
    timeZone: record.timeZone,
    endsAt: record.endsAt,
    maxRuns: record.maxRuns,
    target: record.target,
    notificationPolicy: record.notificationPolicy,
    projectPath: record.projectPath,
    creator: record.creator,
    attention: record.attention,
    nextRunAt: record.enabled ? record.nextRunAt : null,
    nextNominalAt: record.enabled ? record.nextNominalAt : null,
    waitingSince: record.enabled ? record.waitingSince : null,
    runCount: record.runCount,
    lastRun,
    heartbeat: presentHeartbeat(record),
    recentSessionIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
