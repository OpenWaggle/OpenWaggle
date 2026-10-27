import {
  HEARTBEAT_STOP_CONDITION_REQUIRED_MESSAGE,
  heartbeatHasStopCondition,
} from '@shared/domain/scheduled-tasks/heartbeat-rules'
import {
  HEARTBEAT_IDLE_PAUSE_DEFAULT,
  type HeartbeatSettingsInput,
  type ScheduledTaskKind,
  type ScheduledTaskRejectionCode,
  type ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import type {
  ScheduledTaskRecord,
  StoredHeartbeatWakeCheck,
} from '../ports/scheduled-task-repository'
import { scheduledTaskHooks } from './scheduled-task-hooks'
import type { ScheduledTaskPrincipal } from './scheduled-task-principal'

export function rejectedOutcome(code: ScheduledTaskRejectionCode, message: string) {
  return { effect: 'rejected', code, message } satisfies ScheduledTasksOutcome
}

export type HeartbeatRecordFields = Pick<
  ScheduledTaskRecord,
  'stopWhen' | 'indefinite' | 'idlePauseAfter' | 'consecutiveIdleRuns' | 'wakeCheck' | 'autoPause'
>

export const DEFAULT_HEARTBEAT_FIELDS: HeartbeatRecordFields = {
  stopWhen: null,
  indefinite: false,
  idlePauseAfter: HEARTBEAT_IDLE_PAUSE_DEFAULT,
  consecutiveIdleRuns: 0,
  wakeCheck: null,
  autoPause: null,
}

/** Stop conditions, Wake checks and idle Auto-pause belong to a Heartbeat alone. */
export function heartbeatOnlyRefusal(
  kind: ScheduledTaskKind,
  settings: HeartbeatSettingsInput | undefined,
) {
  if (kind === 'heartbeat' || settings === undefined) return null
  return rejectedOutcome(
    'heartbeat_only',
    'Stop conditions, Wake checks and idle Auto-pause apply only to a Heartbeat.',
  )
}

/** Every Heartbeat needs a way to finish (#388): refused here, whatever client sent it. */
export function stopConditionRefusal(record: ScheduledTaskRecord) {
  if (record.kind !== 'heartbeat' || heartbeatHasStopCondition(record)) return null
  return rejectedOutcome('stop_condition_required', HEARTBEAT_STOP_CONDITION_REQUIRED_MESSAGE)
}

/**
 * A Wake check as set by `principal`. The user setting a command (in the app or the CLI as
 * themselves) approves it by that act; anyone else's new command needs the user's approval when
 * the Heartbeat's Session asks for approval, and holds the Heartbeat until then.
 */
function wakeCheckFor(input: {
  readonly principal: ScheduledTaskPrincipal
  readonly current: StoredHeartbeatWakeCheck | null
  readonly settings: NonNullable<HeartbeatSettingsInput['wakeCheck']>
  readonly sessionId: string
  readonly runsAs: string
  readonly now: number
}) {
  return Effect.gen(function* () {
    const command = input.settings.command.trim()
    const onFailure = input.settings.onFailure ?? input.current?.onFailure ?? 'wake'
    if (input.principal.localUser) {
      return { command, onFailure, approvedCommand: command, pendingSince: null }
    }
    if (input.current?.command === command) return { ...input.current, onFailure }
    const mode = yield* scheduledTaskHooks().sessionAuthorizationMode(input.sessionId, input.runsAs)
    return {
      command,
      onFailure,
      approvedCommand: input.current?.approvedCommand ?? null,
      pendingSince: mode === 'ask-for-approval' ? input.now : null,
    } satisfies StoredHeartbeatWakeCheck
  })
}

/** The Heartbeat fields `settings` set over `current`; an omitted field keeps its value. */
export function heartbeatFieldsFor(input: {
  readonly principal: ScheduledTaskPrincipal
  readonly current: HeartbeatRecordFields
  readonly settings: HeartbeatSettingsInput | undefined
  readonly sessionId: string | null
  /** The caller each run acts as, whose Authorization mode a Wake check runs under. */
  readonly runsAs: string
  readonly now: number
}) {
  return Effect.gen(function* () {
    const { current, settings } = input
    if (!settings) return current
    const wakeCheck =
      settings.wakeCheck === undefined || input.sessionId === null
        ? current.wakeCheck
        : settings.wakeCheck === null
          ? null
          : yield* wakeCheckFor({
              principal: input.principal,
              current: current.wakeCheck,
              settings: settings.wakeCheck,
              sessionId: input.sessionId,
              runsAs: input.runsAs,
              now: input.now,
            })
    return {
      ...current,
      ...(settings.stopWhen !== undefined ? { stopWhen: settings.stopWhen?.trim() || null } : {}),
      ...(settings.indefinite !== undefined ? { indefinite: settings.indefinite } : {}),
      ...(settings.idlePauseAfter !== undefined ? { idlePauseAfter: settings.idlePauseAfter } : {}),
      wakeCheck,
    } satisfies HeartbeatRecordFields
  })
}
