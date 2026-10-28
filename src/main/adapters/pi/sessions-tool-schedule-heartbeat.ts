import {
  HEARTBEAT_STOP_CONDITION_REQUIRED_MESSAGE,
  heartbeatHasStopCondition,
} from '@shared/domain/scheduled-tasks/heartbeat-rules'
import type {
  HeartbeatRunOutcome,
  HeartbeatSettingsInput,
  ScheduledTasksCommand,
  ScheduledTaskTarget,
} from '@shared/types/scheduled-task'
import { sessionsToolThinkingLevel } from './sessions-tool-thinking'

/** The flat Heartbeat fields of a Scheduled task action (#388). */
export interface HeartbeatCommandFields {
  readonly stopWhen?: string | null
  readonly indefinite?: boolean
  readonly idlePauseAfter?: number
  readonly wakeIf?: string | null
  readonly wakeOnFailure?: 'wake' | 'skip'
  readonly model?: string
  readonly thinking?: string
  readonly outcome?: HeartbeatRunOutcome
  readonly note?: string
}

const HEARTBEAT_SETTING_FIELDS = [
  'stopWhen',
  'indefinite',
  'idlePauseAfter',
  'wakeIf',
  'wakeOnFailure',
] as const

export function givenHeartbeatSettings(fields: HeartbeatCommandFields) {
  return HEARTBEAT_SETTING_FIELDS.filter((field) => fields[field] !== undefined)
}

function wakeCheck(fields: HeartbeatCommandFields): HeartbeatSettingsInput['wakeCheck'] {
  if (fields.wakeIf === null) return null
  if (fields.wakeIf !== undefined) {
    return {
      command: fields.wakeIf,
      ...(fields.wakeOnFailure ? { onFailure: fields.wakeOnFailure } : {}),
    }
  }
  if (fields.wakeOnFailure !== undefined) {
    throw new Error('wakeOnFailure needs wakeIf, the Wake check it applies to.')
  }
  return undefined
}

/** The Heartbeat settings the flat fields set, or undefined when they set none. */
export function heartbeatSettingsInput(
  fields: HeartbeatCommandFields,
): HeartbeatSettingsInput | undefined {
  if (givenHeartbeatSettings(fields).length === 0) return undefined
  const check = wakeCheck(fields)
  return {
    ...(fields.stopWhen !== undefined ? { stopWhen: fields.stopWhen } : {}),
    ...(fields.indefinite !== undefined ? { indefinite: fields.indefinite } : {}),
    ...(fields.idlePauseAfter !== undefined ? { idlePauseAfter: fields.idlePauseAfter } : {}),
    ...(check !== undefined ? { wakeCheck: check } : {}),
  }
}

/** A Heartbeat must have a way to finish; the tool says so before asking the Host (#388). */
export function assertHeartbeatCanFinish(fields: Parameters<typeof heartbeatHasStopCondition>[0]) {
  if (!heartbeatHasStopCondition(fields)) throw new Error(HEARTBEAT_STOP_CONDITION_REQUIRED_MESSAGE)
}

type HeartbeatTarget = Extract<ScheduledTaskTarget, { kind: 'heartbeat' }>

/** A Heartbeat target with its own model for its Runs; given fields win over the current ones. */
export function heartbeatTarget(
  sessionId: string,
  fields: HeartbeatCommandFields,
  base?: HeartbeatTarget,
): HeartbeatTarget {
  const modelId = fields.model ?? base?.modelId
  const thinkingLevel = sessionsToolThinkingLevel(fields.thinking) ?? base?.thinkingLevel
  return {
    kind: 'heartbeat',
    sessionId,
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
}

/** The Run outcome a Heartbeat Run reports about itself; the Run is the calling one. */
export function reportOutcomeCommand(
  fields: HeartbeatCommandFields,
  runId: string | undefined,
): ScheduledTasksCommand {
  if (!fields.outcome) throw new Error('schedule_outcome requires outcome acted, idle, or done.')
  if (!runId) throw new Error('schedule_outcome reports on the calling Heartbeat Run.')
  return {
    operation: 'report-outcome',
    runId,
    outcome: fields.outcome,
    ...(fields.note?.trim() ? { note: fields.note.trim() } : {}),
  }
}
