import type {
  HeartbeatAutoPause,
  HeartbeatWakeCheckFailurePolicy,
  ScheduledTaskAttention,
  ScheduledTaskCreator,
  ScheduledTaskKind,
  ScheduledTaskNotificationPolicy,
  ScheduledTaskRun,
  ScheduledTaskRunOutcome,
  ScheduledTaskRunReason,
  ScheduledTaskRunTrigger,
  ScheduledTaskRunWakeCheck,
  ScheduledTaskTarget,
  TaskSchedule,
} from '@shared/types/scheduled-task'
import { Context, type Effect } from 'effect'
import type { HeartbeatRunContext } from '../domain/scheduled-tasks/heartbeat-run-context'
import type { ScheduledTaskRepositoryError } from '../errors'

/** A Heartbeat's stored Wake check and the exact command the user approved, if any. */
export interface StoredHeartbeatWakeCheck {
  readonly command: string
  readonly onFailure: HeartbeatWakeCheckFailurePolicy
  readonly approvedCommand: string | null
  readonly pendingSince: number | null
}

/**
 * A Scheduled task as the Session Host stores it. `ownerKey` names whose task it is (the local
 * user, or one CLI client profile, for that profile's agents too); `creatorCallerId` is the exact
 * caller whose authority every run revalidates (ADR 0057, ADR 0058).
 */
export interface ScheduledTaskRecord {
  readonly id: string
  readonly ownerKey: string
  readonly creatorCallerId: string
  readonly creator: ScheduledTaskCreator
  readonly creatorWorkingDirectory: string | null
  readonly kind: ScheduledTaskKind
  readonly name: string
  readonly prompt: string
  readonly enabled: boolean
  readonly schedule: TaskSchedule
  readonly timeZone: string
  /** Where the schedule's occurrences are counted from: creation or the last reschedule. */
  readonly anchorAt: number
  readonly endsAt: number | null
  readonly maxRuns: number | null
  readonly target: ScheduledTaskTarget
  readonly projectPath: string | null
  readonly notificationPolicy: ScheduledTaskNotificationPolicy
  readonly attention: ScheduledTaskAttention | null
  readonly nextRunAt: number | null
  readonly nextNominalAt: number | null
  readonly waitingSince: number | null
  readonly runCount: number
  /** Heartbeat settings (#388); a Launch schedule keeps the defaults and never uses them. */
  readonly stopWhen: string | null
  readonly indefinite: boolean
  readonly idlePauseAfter: number
  readonly consecutiveIdleRuns: number
  readonly wakeCheck: StoredHeartbeatWakeCheck | null
  readonly autoPause: HeartbeatAutoPause | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NewScheduledTaskRecord extends ScheduledTaskRecord {
  readonly createIdempotencyKey: string | null
}

/** The fields a Scheduled task's own lifecycle changes; anything omitted is kept. */
export type ScheduledTaskRecordChanges = Partial<
  Pick<
    ScheduledTaskRecord,
    | 'name'
    | 'prompt'
    | 'enabled'
    | 'schedule'
    | 'timeZone'
    | 'anchorAt'
    | 'endsAt'
    | 'maxRuns'
    | 'target'
    | 'projectPath'
    | 'notificationPolicy'
    | 'attention'
    | 'nextRunAt'
    | 'nextNominalAt'
    | 'waitingSince'
    | 'runCount'
    | 'stopWhen'
    | 'indefinite'
    | 'idlePauseAfter'
    | 'consecutiveIdleRuns'
    | 'wakeCheck'
    | 'autoPause'
  >
> & { readonly updatedAt: number }

export interface ScheduledTaskRunStart {
  readonly id: string
  readonly taskId: string
  readonly taskName: string
  readonly trigger: ScheduledTaskRunTrigger
  readonly nominalAt: number
  readonly firedAt: number
  readonly missedCount: number
  readonly idempotencyKey: string
  readonly callerId: string
  readonly previousSessionId: string | null
  readonly previousFiredAt: number | null
  /** What a Heartbeat Run is told about its task, when the firing sends one. */
  readonly context?: HeartbeatRunContext
}

export interface ScheduledTaskRunSettlement {
  readonly status: 'started' | 'skipped' | 'failed'
  readonly reason?: ScheduledTaskRunReason
  readonly message?: string
  readonly sessionId?: string
  readonly runId?: string
  readonly wakeCheck?: ScheduledTaskRunWakeCheck
}

/** The Scheduled task run that started one Session Run, found by that Run's id. */
export interface ScheduledTaskRunOfSessionRun {
  readonly id: string
  readonly taskId: string
  readonly sessionId: string
  readonly outcome: ScheduledTaskRunOutcome | null
}

export interface ScheduledTaskSessionActivity {
  readonly archived: boolean
  readonly activeRunId: string | null
  readonly followUpCount: number
  readonly pinned: boolean
  readonly runCount: number
  readonly latestRunStatus: string | null
  readonly piSessionFile: string | null
  /** Where a Wake check runs: the Session's Workspace, and its project. */
  readonly workingPath: string | null
  readonly projectPath: string | null
}

export interface ScheduledTaskRepositoryShape {
  readonly insert: (
    record: NewScheduledTaskRecord,
  ) => Effect.Effect<ScheduledTaskRecord, ScheduledTaskRepositoryError>
  readonly findByCreateKey: (
    ownerKey: string,
    createIdempotencyKey: string,
  ) => Effect.Effect<ScheduledTaskRecord | null, ScheduledTaskRepositoryError>
  readonly get: (
    taskId: string,
  ) => Effect.Effect<ScheduledTaskRecord | null, ScheduledTaskRepositoryError>
  /** Applies `changes` only while the task's `updatedAt` still equals `expectedUpdatedAt`. */
  readonly update: (
    taskId: string,
    expectedUpdatedAt: number,
    changes: ScheduledTaskRecordChanges,
  ) => Effect.Effect<ScheduledTaskRecord | null, ScheduledTaskRepositoryError>
  readonly delete: (taskId: string) => Effect.Effect<boolean, ScheduledTaskRepositoryError>
  readonly list: (filter: {
    readonly ownerKey?: string
    readonly projectPath?: string
    readonly targetSessionId?: string
    readonly limit: number
  }) => Effect.Effect<readonly ScheduledTaskRecord[], ScheduledTaskRepositoryError>
  readonly countForOwner: (ownerKey: string) => Effect.Effect<number, ScheduledTaskRepositoryError>
  /** Enabled tasks whose next fire time has come, earliest first. */
  readonly listDue: (
    now: number,
    limit: number,
  ) => Effect.Effect<readonly ScheduledTaskRecord[], ScheduledTaskRepositoryError>
  readonly listEnabled: () => Effect.Effect<
    readonly ScheduledTaskRecord[],
    ScheduledTaskRepositoryError
  >
  readonly startRun: (
    run: ScheduledTaskRunStart,
  ) => Effect.Effect<void, ScheduledTaskRepositoryError>
  readonly settleRun: (
    runId: string,
    settlement: ScheduledTaskRunSettlement,
  ) => Effect.Effect<void, ScheduledTaskRepositoryError>
  /** Records a run that never dispatched (skipped, or failed before a request was sent). */
  readonly recordRun: (
    run: ScheduledTaskRunStart & ScheduledTaskRunSettlement,
  ) => Effect.Effect<void, ScheduledTaskRepositoryError>
  /** The run that started this Session Run, if a Scheduled task started it. */
  readonly runOfSessionRun: (
    sessionRunId: string,
  ) => Effect.Effect<ScheduledTaskRunOfSessionRun | null, ScheduledTaskRepositoryError>
  /** Records a Run outcome: a reported one replaces any earlier; an inferred one only fills in. */
  readonly recordRunOutcome: (
    runId: string,
    outcome: ScheduledTaskRunOutcome,
  ) => Effect.Effect<boolean, ScheduledTaskRepositoryError>
  readonly getRun: (
    runId: string,
  ) => Effect.Effect<ScheduledTaskRun | null, ScheduledTaskRepositoryError>
  readonly listRuns: (input: {
    readonly taskId: string
    readonly limit: number
    readonly before?: number
  }) => Effect.Effect<readonly ScheduledTaskRun[], ScheduledTaskRepositoryError>
  readonly lastRuns: (
    taskIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, ScheduledTaskRun>, ScheduledTaskRepositoryError>
  /** Sessions each task's recent runs started or delivered into, newest first. */
  readonly recentSessionIds: (
    taskIds: readonly string[],
    perTask: number,
  ) => Effect.Effect<ReadonlyMap<string, readonly string[]>, ScheduledTaskRepositoryError>
  /** The latest run that started a Session, for a Launch schedule's one-at-a-time rule. */
  readonly lastStartedRun: (
    taskId: string,
  ) => Effect.Effect<ScheduledTaskRun | null, ScheduledTaskRepositoryError>
  /** Whose authority a Session agent acts under, and the Session's title, for task ownership. */
  readonly sessionAuthorityOrigin: (
    sessionId: string,
  ) => Effect.Effect<
    { readonly originCallerId: string; readonly title: string; readonly archived: boolean } | null,
    ScheduledTaskRepositoryError
  >
  /** What a Scheduled task run checks about a Session before it sends anything. */
  readonly sessionActivity: (
    sessionId: string,
  ) => Effect.Effect<ScheduledTaskSessionActivity | null, ScheduledTaskRepositoryError>
  /**
   * Runs a Host stopped while they dispatched, settled from what Session Control recorded under
   * their idempotency key: a request it accepted ends started, any other run ends failed. None is
   * sent again under its own key.
   */
  readonly settleInterruptedRuns: (
    messages: InterruptedRunMessages,
  ) => Effect.Effect<readonly InterruptedScheduledTaskRun[], ScheduledTaskRepositoryError>
}

export interface InterruptedRunMessages {
  /** Session Control never recorded the request: nothing was sent. */
  readonly notSent: string
  /** Session Control recorded the request and refused it. */
  readonly refused: string
}

/** A run a previous Host stopped in the middle of sending, and what became of it. */
export interface InterruptedScheduledTaskRun {
  readonly taskId: string
  readonly trigger: ScheduledTaskRunTrigger
  readonly nominalAt: number
  /** Session Control recorded the request, so the firing happened and the task moves on. */
  readonly delivered: boolean
  readonly started: boolean
}

export class ScheduledTaskRepository extends Context.Tag('@openwaggle/ScheduledTaskRepository')<
  ScheduledTaskRepository,
  ScheduledTaskRepositoryShape
>() {}
