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

/**
 * Who started a Run: its originating caller, and its Scheduled task when one fired it. A Hive wake
 * acts for the Session's latest Run before it, so a wake reads that Run's origin.
 */
export interface DesktopNotificationRunFacts {
  readonly originCallerId: string
  readonly scheduledTaskPolicy: ScheduledTaskNotificationPolicy | null
  /** Who stopped the Run, when it was interrupted by a caller. */
  readonly interruptedByCallerId?: string | null
  /** When the Run itself was created. */
  readonly startedAt?: number | null
}

/** A Session's latest Run by creation, as the Host stored it. */
export interface DesktopNotificationLatestRun {
  readonly runId: string
  readonly status: string
  readonly hiveWake: boolean
}

/**
 * What is still running in a root Session's Hive (ADR 0065): its Workers are every Session below
 * it by spawn, at any depth, archived or not. A Run is running while starting, active or stopping.
 */
export interface DesktopNotificationHiveActivity {
  /** A Run of the root Session itself is running. */
  readonly rootRunning: boolean
  /** A Run of a Worker below the root is running. */
  readonly workersRunning: boolean
  /**
   * A Hive wake is still coming for the root or a Worker below it: an idle parent holds a Worker
   * update the Host would wake it for, by the same candidate and authority checks the wake uses.
   */
  readonly wakeComing: boolean
  /**
   * The wake coming is for an agent-made Session, a Worker or a root an agent made, so a full
   * Active Workers limit defers it. A wake of the person's own Session is never held back.
   */
  readonly limitedWakeComing: boolean
  /**
   * The message behind the Run asked about was sent while a Worker below the root was running:
   * the person asked about work in progress. It is judged by when the Host accepted the message,
   * so a queued Follow-up counts from when it was sent. False when no Run was named.
   */
  readonly runStartedWhileWorkersRan: boolean
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
  /** The root of the Hive the Session belongs to, by spawn: itself when it has no parent. */
  readonly hiveRootSessionId: (sessionId: string) => Effect.Effect<string, Error>
  /** What still runs below `rootSessionId`, and whether `runId` (its own Run) started mid-work. */
  readonly hiveActivity: (
    rootSessionId: string,
    runId: string | null,
  ) => Effect.Effect<DesktopNotificationHiveActivity, Error>
  /** The Session's latest Run, or null when it has none. */
  readonly latestRun: (
    sessionId: string,
  ) => Effect.Effect<DesktopNotificationLatestRun | null, Error>
  /** How many active Runs of agents' work there are, as the Active Workers limit counts them. */
  readonly activeWorkerRunCount: () => Effect.Effect<number, Error>
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
