import { randomUUID } from 'node:crypto'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId } from '@shared/types/brand'
import { machineTimeZone } from '@shared/utils/zoned-time'
import * as Effect from 'effect/Effect'
import type {
  WakeCheckExecution,
  WakeCheckRequest,
} from '../domain/scheduled-tasks/wake-check-decision'
import { resolveEffectiveAuthorizationMode } from './agent-authorization-mode'

export type { WakeCheckExecution, WakeCheckRequest }

/** A Heartbeat Run settled; its tool uses decide its Run outcome when it reported none. */
export interface HeartbeatRunEnd {
  readonly sessionId: string
  readonly runId: string
  readonly completed: boolean
  readonly toolUses: readonly {
    readonly name: string
    readonly args: Readonly<Record<string, unknown>>
  }[]
}

/**
 * What Scheduled task commands need from the Session Host's scheduler: the clock, identities,
 * the machine's time zone, a wake-up when tasks change, and an immediate run. The scheduler
 * installs them when the Host starts; until then a run-now is refused as unavailable. A Wake
 * check is unavailable until the Host installs its runner, and a Heartbeat Run's end is handled
 * only while the scheduler runs.
 */
export interface ScheduledTaskHooks {
  readonly now: () => number
  readonly newId: () => string
  readonly defaultTimeZone: () => string
  readonly tasksChanged: () => void
  readonly requestRunNow: (taskId: string) => Effect.Effect<'accepted' | 'busy' | 'unavailable'>
  /** The Authorization mode a Run of this Session would use for this caller, read now. */
  readonly sessionAuthorizationMode: (
    sessionId: string,
    callerId: string,
  ) => Effect.Effect<AgentAuthorizationMode>
  readonly runWakeCheck: (request: WakeCheckRequest) => Effect.Effect<WakeCheckExecution>
  readonly heartbeatRunEnded: (end: HeartbeatRunEnd) => void
}

const DEFAULT_HOOKS: ScheduledTaskHooks = {
  now: () => Date.now(),
  newId: () => randomUUID(),
  defaultTimeZone: machineTimeZone,
  tasksChanged: () => undefined,
  requestRunNow: () => Effect.succeed('unavailable' as const),
  sessionAuthorizationMode: (sessionId, callerId) =>
    Effect.promise(() =>
      resolveEffectiveAuthorizationMode(SessionId(sessionId), undefined, callerId),
    ),
  runWakeCheck: () =>
    Effect.succeed({
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      truncated: false,
      startError: 'The Session Host cannot run Wake checks here.',
    }),
  heartbeatRunEnded: () => undefined,
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
