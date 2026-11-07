import type { ScheduledTaskNotificationPolicy } from '@shared/types/scheduled-task'
import { Context, type Effect } from 'effect'

/** What a Desktop notification needs to know about a Session (ADR 0062). */
export interface DesktopNotificationSessionFacts {
  readonly sessionId: string
  readonly title: string
  readonly projectPath: string | null
  readonly archived: boolean
  /** Set for a Worker: the Session that spawned it. */
  readonly parentSessionId: string | null
  readonly parentTitle: string | null
}

/** Who started a Run: its originating caller, and its Scheduled task when one fired it. */
export interface DesktopNotificationRunFacts {
  readonly originCallerId: string
  readonly scheduledTaskPolicy: ScheduledTaskNotificationPolicy | null
}

export interface DesktopNotificationInterruptedRun {
  readonly sessionId: string
  readonly runId: string
}

/** Read-only Host facts the Desktop notification observer decides from. */
export interface DesktopNotificationFactsShape {
  readonly session: (
    sessionId: string,
  ) => Effect.Effect<DesktopNotificationSessionFacts | null, Error>
  readonly run: (
    sessionId: string,
    runId: string,
  ) => Effect.Effect<DesktopNotificationRunFacts | null, Error>
  /** When the person last opened the Session, or null if never. */
  readonly lastVisitedAt: (sessionId: string) => Effect.Effect<number | null, Error>
  /** Live Workers whose Delegation needs attention while no agent will pick them up. */
  readonly stuckWorkerIds: () => Effect.Effect<readonly string[], Error>
  /** Runs recovery marked as interrupted by losing the Host at or after `since`. */
  readonly runsInterruptedByHostLossSince: (
    since: number,
  ) => Effect.Effect<readonly DesktopNotificationInterruptedRun[], Error>
}

export class DesktopNotificationFacts extends Context.Tag('@openwaggle/DesktopNotificationFacts')<
  DesktopNotificationFacts,
  DesktopNotificationFactsShape
>() {}
