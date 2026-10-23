import type { MessageScheduledTaskOrigin } from '@shared/types/agent'
import { SCHEDULED_TASK_KINDS } from '@shared/types/scheduled-task'
import { createLogger } from '../logger'

const logger = createLogger('session-run-scheduled-task')

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
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return undefined
  return { record, id: record.id, name: record.name }
}

/**
 * The Scheduled task a Run's prompt message records, so the transcript names its origin. Like the
 * Run identity it comes from the Host's Scheduled task run record, never from the prompt text.
 */
export function scheduledTaskMessageOrigin(
  value: string | null | undefined,
): MessageScheduledTaskOrigin | undefined {
  const task = scheduledTaskRecord(value)
  if (!task?.id || !task.name) return undefined
  const kind = SCHEDULED_TASK_KINDS.find((candidate) => candidate === task.record.kind)
  return { taskId: task.id, name: task.name, ...(kind ? { kind } : {}) }
}
