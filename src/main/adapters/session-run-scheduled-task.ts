import type { MessageScheduledTaskOrigin } from '@shared/types/agent'
import { SCHEDULED_TASK_KINDS } from '@shared/types/scheduled-task'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { isObjectValue } from '@shared/utils/object-shape'
import {
  decodeHeartbeatRunContext,
  type HeartbeatRunContext,
} from '../domain/scheduled-tasks/heartbeat-run-context'
import { createLogger } from '../logger'

const logger = createLogger('session-run-scheduled-task')

/** The Scheduled task run record the Host wrote for the Run's request, each field still unchecked. */
interface ScheduledTaskRunRecord {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly trigger: string
  readonly firedAt: number
  readonly nominalAt: number
  readonly missedCount: number
  readonly previousFiredAt: number
  readonly previousSessionId: string
  /** Host-authored Heartbeat context JSON (#388). */
  readonly context: string
}

export type ScheduledTaskRunFields = UncheckedFields<ScheduledTaskRunRecord>

/** The Scheduled task run record the Run's request joined to, when it has an id and a name. */
export function scheduledTaskRecord(value: string | null | undefined) {
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    // The Host writes this record; a run without its provenance beats a run that cannot start.
    logger.warn('Ignored an unreadable Scheduled task run record', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
  if (!isObjectValue(parsed)) return undefined
  const record: ScheduledTaskRunFields = parsed
  const { id, name } = record
  if (typeof id !== 'string' || typeof name !== 'string') return undefined
  return { record, id, name }
}

/**
 * What a Heartbeat Run is told about its task (#388), from the run record's Host-authored context.
 * A context that does not decode is dropped with a warning: the Run still starts, without it.
 */
export function scheduledTaskRunContext(record: ScheduledTaskRunFields) {
  const { context } = record
  if (typeof context !== 'string') return undefined
  try {
    const result: HeartbeatRunContext | undefined = decodeHeartbeatRunContext(context)
    return result
  } catch (error) {
    logger.warn('Ignored an unreadable Heartbeat run context', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * The Scheduled task a Run's prompt message records, so the transcript names its origin. Like the
 * Run identity it comes from the Host's Scheduled task run record, never from the prompt text.
 */
export function scheduledTaskMessageOrigin(value: string | null | undefined) {
  const task = scheduledTaskRecord(value)
  if (!task?.id || !task.name) return undefined
  const kind = SCHEDULED_TASK_KINDS.find((candidate) => candidate === task.record.kind)
  const origin: MessageScheduledTaskOrigin | undefined = {
    taskId: task.id,
    name: task.name,
    ...(kind ? { kind } : {}),
  }
  return origin
}
