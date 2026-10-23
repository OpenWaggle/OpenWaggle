import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import { decodeScheduledTaskTarget, decodeTaskSchedule } from '@shared/schemas/scheduled-task'
import {
  SCHEDULED_TASK_ATTENTION_REASONS,
  SCHEDULED_TASK_RUN_REASONS,
  type ScheduledTaskAttention,
  type ScheduledTaskCreator,
  type ScheduledTaskRun,
} from '@shared/types/scheduled-task'
import { Schema } from 'effect'
import { ScheduledTaskRepositoryError } from '../errors'
import type { ScheduledTaskRecord } from '../ports/scheduled-task-repository'

export function repositoryError(operation: string) {
  return (cause: unknown) => new ScheduledTaskRepositoryError({ operation, cause })
}

export interface ScheduledTaskRow {
  readonly id: string
  readonly owner_key: string
  readonly creator_caller_id: string
  readonly creator_kind: string
  readonly creator_label: string
  readonly creator_session_id: string | null
  readonly creator_working_directory: string | null
  readonly kind: string
  readonly name: string
  readonly prompt: string
  readonly enabled: number
  readonly schedule_json: string
  readonly time_zone: string
  readonly anchor_at: number
  readonly ends_at: number | null
  readonly max_runs: number | null
  readonly target_json: string
  readonly project_path: string | null
  readonly notification_policy: string
  readonly attention_reason: string | null
  readonly attention_message: string | null
  readonly attention_since: number | null
  readonly next_run_at: number | null
  readonly next_nominal_at: number | null
  readonly waiting_since: number | null
  readonly run_count: number
  readonly created_at: number
  readonly updated_at: number
}

export interface ScheduledTaskRunRow {
  readonly id: string
  readonly task_id: string
  readonly trigger: string
  readonly nominal_at: number
  readonly fired_at: number
  readonly missed_count: number
  readonly status: string
  readonly reason: string | null
  readonly message: string | null
  readonly session_id: string | null
  readonly run_id: string | null
}

export const SCHEDULED_TASK_COLUMNS = `id, owner_key, creator_caller_id, creator_kind, creator_label,
  creator_session_id, creator_working_directory, kind, name, prompt, enabled, schedule_json,
  time_zone, anchor_at, ends_at, max_runs, target_json, project_path, notification_policy,
  attention_reason, attention_message, attention_since, next_run_at, next_nominal_at,
  waiting_since, run_count, created_at, updated_at`

export const SCHEDULED_TASK_RUN_COLUMNS = `id, task_id, trigger, nominal_at, fired_at, missed_count,
  status, reason, message, session_id, run_id`

const creatorKindSchema = Schema.Literal('local-user', 'profile', 'session-agent')
const kindSchema = Schema.Literal('heartbeat', 'launch')
const policySchema = Schema.Literal('every-run', 'failures-only')
const attentionReasonSchema = Schema.Literal(...SCHEDULED_TASK_ATTENTION_REASONS)
const runTriggerSchema = Schema.Literal('schedule', 'catch-up', 'run-now')
const runStatusSchema = Schema.Literal('started', 'skipped', 'failed', 'dispatching')
const runReasonSchema = Schema.Literal(...SCHEDULED_TASK_RUN_REASONS)

function creatorOf(row: ScheduledTaskRow): ScheduledTaskCreator {
  return {
    kind: decodeUnknownExactOrThrow(creatorKindSchema, row.creator_kind),
    label: row.creator_label,
    ...(row.creator_session_id ? { sessionId: row.creator_session_id } : {}),
  }
}

function attentionOf(row: ScheduledTaskRow): ScheduledTaskAttention | null {
  if (row.attention_reason === null) return null
  return {
    reason: decodeUnknownExactOrThrow(attentionReasonSchema, row.attention_reason),
    message: row.attention_message ?? '',
    since: row.attention_since ?? row.updated_at,
  }
}

export function decodeScheduledTaskRow(row: ScheduledTaskRow): ScheduledTaskRecord {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    creatorCallerId: row.creator_caller_id,
    creator: creatorOf(row),
    creatorWorkingDirectory: row.creator_working_directory,
    kind: decodeUnknownExactOrThrow(kindSchema, row.kind),
    name: row.name,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    schedule: decodeTaskSchedule(parseJsonUnknown(row.schedule_json)),
    timeZone: row.time_zone,
    anchorAt: row.anchor_at,
    endsAt: row.ends_at,
    maxRuns: row.max_runs,
    target: decodeScheduledTaskTarget(parseJsonUnknown(row.target_json)),
    projectPath: row.project_path,
    notificationPolicy: decodeUnknownExactOrThrow(policySchema, row.notification_policy),
    attention: attentionOf(row),
    nextRunAt: row.next_run_at,
    nextNominalAt: row.next_nominal_at,
    waitingSince: row.waiting_since,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function decodeScheduledTaskRunRow(row: ScheduledTaskRunRow): ScheduledTaskRun {
  const status = decodeUnknownExactOrThrow(runStatusSchema, row.status)
  return {
    id: row.id,
    taskId: row.task_id,
    trigger: decodeUnknownExactOrThrow(runTriggerSchema, row.trigger),
    nominalAt: row.nominal_at,
    firedAt: row.fired_at,
    missedCount: row.missed_count,
    // A run still dispatching has sent its request; it reads as started until it settles.
    status: status === 'dispatching' ? 'started' : status,
    ...(row.reason ? { reason: decodeUnknownExactOrThrow(runReasonSchema, row.reason) } : {}),
    ...(row.message ? { message: row.message } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
  }
}
