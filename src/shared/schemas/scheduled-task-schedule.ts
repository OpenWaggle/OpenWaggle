/**
 * When a Scheduled task fires and where it delivers (CONTEXT.md: Task schedule). Each schema is
 * the one source of its type in `@shared/types/scheduled-task`.
 */
import { Schema } from '@shared/schema'
import {
  ISO_WEEKDAYS,
  SCHEDULED_TASK_MAX_INTERVAL_MINUTES,
  SCHEDULED_TASK_NOTIFICATION_POLICIES,
  SCHEDULED_TASK_RRULE_MAX_LENGTH,
} from '@shared/types/scheduled-task'
import { THINKING_LEVELS } from '@shared/types/settings'
import { sessionInputIdSchema, sessionInputPathSchema } from './session-input'

const MODEL_ID_MAX_LENGTH = 256
const AGENT_DEFINITION_NAME_MAX_LENGTH = 128
const DAYS_PER_WEEK = 7

export const taskScheduleSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('interval'),
    everyMinutes: Schema.Number.pipe(
      Schema.int(),
      Schema.between(1, SCHEDULED_TASK_MAX_INTERVAL_MINUTES),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('daily'),
    /** Local wall-clock time `HH:MM` in the task's time zone. */
    at: Schema.String.pipe(Schema.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    /** Omitted means every day. */
    weekdays: Schema.optionalWith(
      Schema.Array(Schema.Literal(...ISO_WEEKDAYS)).pipe(
        Schema.minItems(1),
        Schema.maxItems(DAYS_PER_WEEK),
      ),
      { exact: true },
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('rrule'),
    /** An RFC 5545 recurrence rule without DTSTART, UNTIL or COUNT, read in the task's zone. */
    rule: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(SCHEDULED_TASK_RRULE_MAX_LENGTH),
    ),
  }),
)

/** A model and thinking level for this task's Runs only; omitted uses the Session's or project's. */
const modelChoiceFields = {
  modelId: Schema.optionalWith(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MODEL_ID_MAX_LENGTH)),
    { exact: true },
  ),
  thinkingLevel: Schema.optionalWith(Schema.Literal(...THINKING_LEVELS), { exact: true }),
}

export const launchScheduleWorkspaceSchema = Schema.Literal('new-worktree', 'local')

export const scheduledTaskTargetSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('heartbeat'),
    sessionId: sessionInputIdSchema,
    ...modelChoiceFields,
  }),
  Schema.Struct({
    kind: Schema.Literal('launch'),
    projectPath: sessionInputPathSchema.pipe(Schema.minLength(1)),
    workspace: launchScheduleWorkspaceSchema,
    ...modelChoiceFields,
    agentDefinitionName: Schema.optionalWith(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(AGENT_DEFINITION_NAME_MAX_LENGTH)),
      { exact: true },
    ),
    /** Archive a launched Session once it finished, nothing needs attention, and no one touched it. */
    archiveFinishedSessions: Schema.Boolean,
  }),
)

/** Whom a Scheduled task notifies: every run, or only failures and attention. */
export const notificationPolicySchema = Schema.Literal(...SCHEDULED_TASK_NOTIFICATION_POLICIES)
