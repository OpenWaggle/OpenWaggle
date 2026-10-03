import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { Context, type Effect } from 'effect'
import type { UsageStatisticsObservation } from '../domain/usage-statistics/usage-statistics-observations'

export interface UsageStatisticsRunStart {
  readonly sessionId: SessionId
  readonly runId: string
  /** The caller that wrote the Run's input (its author when another caller re-authorized it). */
  readonly originCallerId: string
  readonly waggle: boolean
  readonly attachments: boolean
  readonly runAuthorizationOverride?: AgentAuthorizationMode | undefined
}

export interface UsageStatisticsRunFinish {
  readonly runId: string
  readonly originCallerId: string
  readonly waggle: boolean
  /** The level requested for the Run, used when Pi did not report the one it applied. */
  readonly thinkingLevel: ThinkingLevel
  readonly terminalStatus:
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'interrupted-by-interaction-timeout'
}

/**
 * Records Usage statistics observations for this process (ADR 0044). Every method records
 * nothing while statistics are off and never fails or delays its caller beyond a small indexed
 * lookup at Run start.
 */
export interface UsageStatisticsRecorderShape {
  readonly record: (observation: UsageStatisticsObservation) => Effect.Effect<void>
  /** A Run became active; makes today an Active install day and notes its start facts. */
  readonly runStarted: (start: UsageStatisticsRunStart) => Effect.Effect<void>
  /** A Run settled; queues its `run.finished` from what was noted while it ran. */
  readonly runFinished: (finish: UsageStatisticsRunFinish) => Effect.Effect<void>
}

/**
 * Optional collaborator. Application and IPC code look it up with `Effect.serviceOption`, so a
 * runtime or test that does not provide it records nothing.
 */
export class UsageStatisticsRecorder extends Context.Tag('@openwaggle/UsageStatisticsRecorder')<
  UsageStatisticsRecorder,
  UsageStatisticsRecorderShape
>() {}
