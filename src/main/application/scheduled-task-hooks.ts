import { randomUUID } from 'node:crypto'
import { machineTimeZone } from '@shared/utils/zoned-time'
import * as Effect from 'effect/Effect'

/**
 * What Scheduled task commands need from the Session Host's scheduler: the clock, identities,
 * the machine's time zone, a wake-up when tasks change, and an immediate run. The scheduler
 * installs them when the Host starts; until then a run-now is refused as unavailable.
 */
export interface ScheduledTaskHooks {
  readonly now: () => number
  readonly newId: () => string
  readonly defaultTimeZone: () => string
  readonly tasksChanged: () => void
  readonly requestRunNow: (taskId: string) => Effect.Effect<'accepted' | 'busy' | 'unavailable'>
}

const DEFAULT_HOOKS: ScheduledTaskHooks = {
  now: () => Date.now(),
  newId: () => randomUUID(),
  defaultTimeZone: machineTimeZone,
  tasksChanged: () => undefined,
  requestRunNow: () => Effect.succeed('unavailable' as const),
}

let installed: ScheduledTaskHooks | null = null

export function installScheduledTaskHooks(hooks: Partial<ScheduledTaskHooks>) {
  const next = { ...DEFAULT_HOOKS, ...hooks }
  installed = next
  return () => {
    if (installed === next) installed = null
  }
}

export function scheduledTaskHooks(): ScheduledTaskHooks {
  return installed ?? DEFAULT_HOOKS
}
