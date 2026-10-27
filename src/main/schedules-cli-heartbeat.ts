import { heartbeatHasStopCondition } from '@shared/domain/scheduled-tasks/heartbeat-rules'
import {
  HEARTBEAT_IDLE_PAUSE_MAX,
  HEARTBEAT_IDLE_PAUSE_MIN,
  type HeartbeatSettingsInput,
  type HeartbeatWakeCheckFailurePolicy,
} from '@shared/types/scheduled-task'
import { CommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'

/** The `openwaggle schedules` options of a Heartbeat's way to finish and Wake check (#388). */
export const HEARTBEAT_CLI_OPTIONS = [
  'stop-when',
  'indefinite',
  'finite',
  'idle-pause-after',
  'wake-if',
  'wake-on-failure',
] as const

export const HEARTBEAT_CLI_FLAGS = ['indefinite', 'finite'] as const

function idlePauseAfter(value: string | undefined) {
  if (value === undefined) return undefined
  const count = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!(count >= HEARTBEAT_IDLE_PAUSE_MIN && count <= HEARTBEAT_IDLE_PAUSE_MAX)) {
    throw new CommandCliUsageError(
      `--idle-pause-after takes a whole number from ${String(HEARTBEAT_IDLE_PAUSE_MIN)} to ${String(HEARTBEAT_IDLE_PAUSE_MAX)}.`,
    )
  }
  return count
}

function failurePolicy(value: string | undefined): HeartbeatWakeCheckFailurePolicy | undefined {
  if (value === undefined) return undefined
  if (value === 'wake' || value === 'skip') return value
  throw new CommandCliUsageError('--wake-on-failure must be wake or skip.')
}

function wakeCheck(arguments_: ParsedArguments): HeartbeatSettingsInput['wakeCheck'] {
  const command = option(arguments_, 'wake-if')
  const onFailure = failurePolicy(option(arguments_, 'wake-on-failure'))
  if (command === 'none') return null
  if (command !== undefined) return { command, ...(onFailure ? { onFailure } : {}) }
  if (onFailure) throw new CommandCliUsageError('--wake-on-failure needs --wake-if <command>.')
  return undefined
}

function indefinite(arguments_: ParsedArguments) {
  const on = hasFlag(arguments_, 'indefinite')
  const off = hasFlag(arguments_, 'finite')
  if (on && off) throw new CommandCliUsageError('Choose --indefinite or --finite, not both.')
  return on ? true : off ? false : undefined
}

/** The Heartbeat settings the options set, or undefined when they set none. */
export function heartbeatSettingsFromOptions(
  arguments_: ParsedArguments,
): HeartbeatSettingsInput | undefined {
  const stopWhen = option(arguments_, 'stop-when')
  const ends = indefinite(arguments_)
  const idle = idlePauseAfter(option(arguments_, 'idle-pause-after'))
  const check = wakeCheck(arguments_)
  const settings: HeartbeatSettingsInput = {
    ...(stopWhen !== undefined ? { stopWhen: stopWhen === 'none' ? null : stopWhen } : {}),
    ...(ends !== undefined ? { indefinite: ends } : {}),
    ...(idle !== undefined ? { idlePauseAfter: idle } : {}),
    ...(check !== undefined ? { wakeCheck: check } : {}),
  }
  return Object.keys(settings).length > 0 ? settings : undefined
}

/** A new Heartbeat must have a way to finish; said before asking the Host (#388). */
export function assertHeartbeatCliCanFinish(input: {
  readonly heartbeat: HeartbeatSettingsInput | undefined
  readonly endsAt?: number | null
  readonly maxRuns?: number | null
}) {
  const settings = input.heartbeat
  const canFinish = heartbeatHasStopCondition({
    ...(settings?.stopWhen !== undefined ? { stopWhen: settings.stopWhen } : {}),
    ...(settings?.indefinite !== undefined ? { indefinite: settings.indefinite } : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
  })
  if (!canFinish) {
    throw new CommandCliUsageError(
      'A Heartbeat needs a way to finish: pass --stop-when <text> (the outcome after which it stops), --ends, --max-runs, or --indefinite.',
    )
  }
}
