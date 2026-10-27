import { heartbeatHasStopCondition } from '@shared/domain/scheduled-tasks/heartbeat-rules'
import {
  HEARTBEAT_IDLE_PAUSE_DEFAULT,
  HEARTBEAT_IDLE_PAUSE_MAX,
  HEARTBEAT_IDLE_PAUSE_MIN,
  type HeartbeatSettingsInput,
  type HeartbeatWakeCheckFailurePolicy,
  type ScheduledTask,
} from '@shared/types/scheduled-task'

/** A Heartbeat's way to finish and Wake check, as the editor holds them. */
export interface HeartbeatDraftFields {
  /** "Stop when…": empty for none. */
  readonly stopWhen: string
  readonly indefinite: boolean
  /** Text as typed. */
  readonly idlePauseAfter: string
  /** Empty for no Wake check. */
  readonly wakeCommand: string
  readonly wakeOnFailure: HeartbeatWakeCheckFailurePolicy
}

export const NEW_HEARTBEAT_DRAFT_FIELDS: HeartbeatDraftFields = {
  stopWhen: '',
  indefinite: false,
  idlePauseAfter: String(HEARTBEAT_IDLE_PAUSE_DEFAULT),
  wakeCommand: '',
  wakeOnFailure: 'wake',
}

export function heartbeatDraftFields(task: ScheduledTask): HeartbeatDraftFields {
  const heartbeat = task.heartbeat
  if (!heartbeat) return NEW_HEARTBEAT_DRAFT_FIELDS
  return {
    stopWhen: heartbeat.stopWhen ?? '',
    indefinite: heartbeat.indefinite,
    idlePauseAfter: String(heartbeat.idlePauseAfter),
    wakeCommand: heartbeat.wakeCheck?.command ?? '',
    wakeOnFailure: heartbeat.wakeCheck?.onFailure ?? 'wake',
  }
}

const INTEGER_PATTERN = /^\d+$/

export type HeartbeatDraftResult =
  | { readonly ok: true; readonly value: HeartbeatSettingsInput }
  | { readonly ok: false; readonly error: string }

export const STOP_CONDITION_DRAFT_ERROR =
  'Say how this Heartbeat finishes: a Stop condition, an end date, a run limit, or Runs indefinitely.'

function idlePauseAfterOf(draft: HeartbeatDraftFields) {
  const idle = draft.idlePauseAfter.trim()
  const count = INTEGER_PATTERN.test(idle) ? Number(idle) : 0
  return count >= HEARTBEAT_IDLE_PAUSE_MIN && count <= HEARTBEAT_IDLE_PAUSE_MAX ? count : null
}

/** The Wake check a draft sets, or undefined when it leaves the task's as it was. */
function wakeCheckOf(draft: HeartbeatDraftFields, original: ScheduledTask | null | undefined) {
  const command = draft.wakeCommand.trim()
  const previous = original?.heartbeat?.wakeCheck ?? null
  const changed =
    !original ||
    (previous?.command ?? '') !== command ||
    (command !== '' && previous?.onFailure !== draft.wakeOnFailure)
  if (!changed) return undefined
  return command ? { command, onFailure: draft.wakeOnFailure } : null
}

/**
 * The Heartbeat settings a draft sets. Editing a task sends its Wake check only when the user
 * changed it, so saving other edits never approves a command someone else set.
 */
export function heartbeatSettingsFromDraft(
  draft: HeartbeatDraftFields,
  end: { readonly endsAt: number | null; readonly maxRuns: number | null },
  original?: ScheduledTask | null,
): HeartbeatDraftResult {
  const stopWhen = draft.stopWhen.trim()
  const idlePauseAfter = idlePauseAfterOf(draft)
  if (idlePauseAfter === null) {
    return { ok: false, error: 'Pause after idle runs must be a whole number from 1 to 20.' }
  }
  if (!heartbeatHasStopCondition({ stopWhen, indefinite: draft.indefinite, ...end })) {
    return { ok: false, error: STOP_CONDITION_DRAFT_ERROR }
  }
  const wakeCheck = wakeCheckOf(draft, original)
  return {
    ok: true,
    value: {
      stopWhen: stopWhen || null,
      indefinite: draft.indefinite,
      idlePauseAfter,
      ...(wakeCheck !== undefined ? { wakeCheck } : {}),
    },
  }
}
