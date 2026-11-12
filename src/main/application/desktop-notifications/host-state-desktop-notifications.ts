import type { DesktopNotificationTarget } from '@shared/types/desktop-notification'
import * as Effect from 'effect/Effect'
import { runSettlementCandidate } from '../../domain/desktop-notifications/desktop-notification-policy'
import type { DesktopNotificationFactsShape } from '../../ports/desktop-notification-facts'
import {
  type DesktopNotificationLedger,
  sessionNotificationTarget,
} from './desktop-notification-ledger'
import type { DesktopNotificationObserver } from './desktop-notification-observer'
import type { ScheduledTaskAttentionSignal } from './desktop-notification-signals'

interface HostStateNotificationDependencies {
  readonly ledger: DesktopNotificationLedger
  readonly observer: DesktopNotificationObserver
  readonly facts: DesktopNotificationFactsShape
  readonly now: () => number
}

/**
 * Desktop notifications for Host state that no single event announces (ADR 0062): Stuck Workers,
 * Runs lost with the previous Host, and Scheduled tasks the Host stopped for attention.
 */
export class HostStateDesktopNotifications {
  private stuckWorkers: ReadonlySet<string> | null = null

  private readonly dependencies: HostStateNotificationDependencies

  constructor(dependencies: HostStateNotificationDependencies) {
    this.dependencies = dependencies
  }

  /**
   * Workers that became Stuck notify once; one that stops being Stuck withdraws its notice. The
   * first scan only records who is Stuck, so a Host restart does not announce them again.
   */
  scanStuckWorkers(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const current = new Set(yield* this.dependencies.facts.stuckWorkerIds())
      const previous = this.stuckWorkers
      this.stuckWorkers = current
      if (previous === null) return
      for (const sessionId of current) {
        if (!previous.has(sessionId)) yield* this.notifyStuck(sessionId)
      }
      for (const sessionId of previous) {
        if (current.has(sessionId)) continue
        const target = sessionNotificationTarget(sessionId)
        if (this.dependencies.ledger.get(target)?.reason === 'stuck') {
          yield* this.dependencies.ledger.withdraw(target)
        }
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logWarning('Stuck Workers could not be checked for Desktop notifications', cause),
      ),
    )
  }

  private notifyStuck(sessionId: string) {
    return Effect.gen(this, function* () {
      const session = yield* this.dependencies.facts.session(sessionId)
      if (!session || session.archived) return
      yield* this.dependencies.ledger.show({
        target: sessionNotificationTarget(sessionId),
        candidate: { category: 'needs-you', reason: 'stuck' },
        subject: { sessionId, projectPath: session.projectPath },
        title: session,
        occurredAt: this.dependencies.now(),
      })
    })
  }

  /** Runs that recovery found interrupted because the Host was lost, announced after start. */
  notifyRunsInterruptedByHostLoss(since: number): Effect.Effect<void> {
    const candidate = runSettlementCandidate('interrupted-by-host-loss')
    return Effect.gen(this, function* () {
      if (!candidate) return
      const { observer, facts, ledger } = this.dependencies
      const runs = yield* facts.runsInterruptedByHostLossSince(since)
      for (const { sessionId, runId } of runs) {
        if (!observer.claimRun(runId)) continue
        yield* observer.forRootRun(sessionId, runId, candidate, (session) =>
          ledger.show({
            target: sessionNotificationTarget(sessionId),
            candidate,
            subject: { sessionId, projectPath: session.projectPath },
            title: session,
            occurredAt: this.dependencies.now(),
          }),
        )
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logWarning('Interrupted Runs could not be announced', cause),
      ),
    )
  }

  /**
   * A Scheduled task the Host stopped for attention always notifies as Failed or interrupted,
   * whatever its policy; one stopped because the person archived its Session does not.
   */
  notifyScheduledTaskAttention(signal: ScheduledTaskAttentionSignal): Effect.Effect<void> {
    if (signal.attention.reason === 'target-session-archived') return Effect.void
    const candidate = {
      category: 'failed-or-interrupted',
      reason: 'scheduled-task-attention',
    } as const
    return Effect.gen(this, function* () {
      const found = signal.targetSessionId
        ? yield* this.dependencies.facts.session(signal.targetSessionId)
        : null
      const session = found && !found.archived ? found : null
      const target: DesktopNotificationTarget = session
        ? sessionNotificationTarget(session.sessionId)
        : { kind: 'scheduled-task', taskId: signal.taskId }
      yield* this.dependencies.ledger.show({
        target,
        candidate,
        subject: {
          sessionId: session?.sessionId ?? null,
          projectPath: session?.projectPath ?? signal.projectPath,
        },
        title: session ?? { title: signal.taskName },
        preview: signal.attention.message,
        occurredAt: signal.attention.since,
      })
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logWarning('A Scheduled task notification failed', cause),
      ),
    )
  }
}
