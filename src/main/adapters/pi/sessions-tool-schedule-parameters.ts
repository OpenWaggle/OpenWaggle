import {
  ISO_WEEKDAYS,
  SCHEDULED_TASK_MAX_INTERVAL_MINUTES,
  SCHEDULED_TASK_MAX_RUNS_LIMIT,
  SCHEDULED_TASK_NAME_MAX_LENGTH,
  SCHEDULED_TASK_PROMPT_MAX_LENGTH,
  SCHEDULED_TASK_RRULE_MAX_LENGTH,
  SCHEDULED_TASK_RUN_PAGE_LIMIT,
  SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH,
} from '@shared/types/scheduled-task'
import { Type } from 'typebox'
import { sessionsToolProjectPath } from './sessions-tool-catalog-parameters'

const scheduleTaskId = Type.String({ minLength: 1 })

const [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY] = ISO_WEEKDAYS
const weekday = Type.Union([
  Type.Literal(MONDAY),
  Type.Literal(TUESDAY),
  Type.Literal(WEDNESDAY),
  Type.Literal(THURSDAY),
  Type.Literal(FRIDAY),
  Type.Literal(SATURDAY),
  Type.Literal(SUNDAY),
])

const schedule = Type.Union(
  [
    Type.Object({
      kind: Type.Literal('interval'),
      everyMinutes: Type.Integer({ minimum: 1, maximum: SCHEDULED_TASK_MAX_INTERVAL_MINUTES }),
    }),
    Type.Object({
      kind: Type.Literal('daily'),
      at: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Wall-clock HH:MM.' }),
      weekdays: Type.Optional(
        Type.Array(weekday, {
          minItems: 1,
          maxItems: ISO_WEEKDAYS.length,
          uniqueItems: true,
          description: '1 = Monday … 7 = Sunday; omitted means every day.',
        }),
      ),
    }),
    Type.Object({
      kind: Type.Literal('rrule'),
      rule: Type.String({
        minLength: 1,
        maxLength: SCHEDULED_TASK_RRULE_MAX_LENGTH,
        description: 'RFC 5545 RRULE without DTSTART, UNTIL, or COUNT.',
      }),
    }),
  ],
  { description: 'When the task fires, read as wall-clock time in timeZone.' },
)

const timing = {
  schedule: Type.Optional(schedule),
  timeZone: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH,
      description: "IANA time zone; omitted uses the machine's zone on create.",
    }),
  ),
  endsAt: Type.Optional(
    Type.Union([Type.String(), Type.Integer({ minimum: 0 }), Type.Null()], {
      description: 'ISO date-time or epoch ms after which the task stops; null clears it.',
    }),
  ),
  maxRuns: Type.Optional(
    Type.Union(
      [Type.Integer({ minimum: 1, maximum: SCHEDULED_TASK_MAX_RUNS_LIMIT }), Type.Null()],
      {
        description: 'Stop after this many runs; null clears it.',
      },
    ),
  ),
  enabled: Type.Optional(Type.Boolean()),
  notificationPolicy: Type.Optional(
    Type.Union([Type.Literal('every-run'), Type.Literal('failures-only')]),
  ),
}

const launchTarget = {
  projectPath: sessionsToolProjectPath,
  workspace: Type.Optional(Type.Union([Type.Literal('new-worktree'), Type.Literal('local')])),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  agent: Type.Optional(Type.String()),
  archiveFinishedSessions: Type.Optional(Type.Boolean()),
}

const content = {
  name: Type.String({ minLength: 1, maxLength: SCHEDULED_TASK_NAME_MAX_LENGTH }),
  prompt: Type.String({ minLength: 1, maxLength: SCHEDULED_TASK_PROMPT_MAX_LENGTH }),
}

/** Scheduled task actions (ADR 0057) over the `scheduled-tasks-v1` contract. */
export const sessionsToolScheduleParameters = [
  Type.Object({
    action: Type.Literal('schedule_list'),
    projectPath: sessionsToolProjectPath,
    sessionId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Union([
      Type.Literal('schedule_read'),
      Type.Literal('schedule_delete'),
      Type.Literal('schedule_run_now'),
    ]),
    scheduleTaskId,
  }),
  Type.Object({
    action: Type.Literal('schedule_runs'),
    scheduleTaskId,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SCHEDULED_TASK_RUN_PAGE_LIMIT })),
    before: Type.Optional(
      Type.Union([Type.String(), Type.Integer({ minimum: 0 })], {
        description: 'Runs fired before this ISO date-time or epoch ms.',
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal('schedule_create'),
    ...content,
    scheduleKind: Type.Union([Type.Literal('heartbeat'), Type.Literal('launch')]),
    ...timing,
    schedule,
    sessionId: Type.Optional(Type.String()),
    ...launchTarget,
    idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    action: Type.Literal('schedule_update'),
    scheduleTaskId,
    name: Type.Optional(content.name),
    prompt: Type.Optional(content.prompt),
    ...timing,
    ...launchTarget,
  }),
] as const
