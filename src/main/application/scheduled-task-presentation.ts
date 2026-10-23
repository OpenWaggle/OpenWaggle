import {
  planNextFiring,
  type ScheduleDefinition,
} from '@shared/domain/scheduled-tasks/task-schedule'
import type { ScheduledTask, ScheduledTaskRun } from '@shared/types/scheduled-task'
import type { ScheduledTaskRecord } from '../ports/scheduled-task-repository'

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
    recentSessionIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
