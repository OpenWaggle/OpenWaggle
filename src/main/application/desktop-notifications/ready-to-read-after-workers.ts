import * as Effect from 'effect/Effect'
import {
  type DesktopNotificationCandidate,
  readyToReadHiveSettled,
  readyToReadTiming,
} from '../../domain/desktop-notifications/desktop-notification-policy'
import type {
  DesktopNotificationFactsShape,
  DesktopNotificationHiveActivity,
  DesktopNotificationSessionFacts,
} from '../../ports/desktop-notification-facts'
import {
  type DesktopNotificationLedger,
  sessionNotificationTarget,
} from './desktop-notification-ledger'

/** How long a Hive may wait for an expected wake to start before its Ready to read shows. */
const HIVE_WAKE_START_GRACE_MS = 30_000

export const READY_TO_READ: DesktopNotificationCandidate = {
  category: 'ready-to-read',
  reason: 'completed',
}

/** A root Session's Run that completed, with the reply its Ready to read previews. */
export interface CompletedRootRun {
  readonly sessionId: string
  readonly runId: string
  readonly hiveWake: boolean
  readonly preview: string | null
  readonly occurredAt: number
}

/** A Ready to read held back until its root Session's Hive settles. */
interface HeldReadyToRead {
  readonly runId: string
  readonly preview: string | null
  readonly occurredAt: number
}

interface ReadyToReadAfterWorkersDependencies {
  readonly ledger: DesktopNotificationLedger
  readonly facts: DesktopNotificationFactsShape
}

/**
 * Ready to read waits for the work (ADR 0063, CONTEXT.md). A root Session's completed Run notifies
 * when nothing runs in its Hive and no Hive wake is coming, or at once when the person asked while
 * Workers ran; otherwise the latest such Run is held, one per root, and shown once when the Hive
 * settles. Held notifications live in memory, like the last reply: a Host restart forgets them.
 */
export class ReadyToReadAfterWorkers {
  private readonly held = new Map<string, HeldReadyToRead>()
  /** When a settled-but-for-a-wake Hive was first seen, per root. */
  private readonly wakeExpectedSince = new Map<string, number>()

  constructor(private readonly dependencies: ReadyToReadAfterWorkersDependencies) {}

  /** The root Session's request ended another way (stopped, failed, archived or deleted). */
  drop(rootSessionId: string) {
    this.held.delete(rootSessionId)
    this.wakeExpectedSince.delete(rootSessionId)
  }

  /** The origin and settings checks passed for `run`, a completed Run of the root `session`. */
  completed(session: DesktopNotificationSessionFacts, run: CompletedRootRun) {
    return Effect.gen(this, function* () {
      const work = yield* this.dependencies.facts.hiveActivity(run.sessionId, run.runId)
      const timing = readyToReadTiming(work, { hiveWake: run.hiveWake })
      if (timing === 'after-workers') {
        this.held.set(run.sessionId, {
          runId: run.runId,
          preview: run.preview,
          occurredAt: run.occurredAt,
        })
        return
      }
      // The work is done: this reply says so and replaces any held one. A reply to a question
      // asked mid-work notifies now, and the request the Workers serve keeps waiting.
      if (timing === 'now') this.held.delete(run.sessionId)
      yield* this.show(session, run.preview, run.occurredAt)
    })
  }

  /** A Run settled somewhere in a Hive: its root's held Ready to read may now be due. */
  settle(sessionId: string, occurredAt: number) {
    return Effect.gen(this, function* () {
      if (this.held.size === 0) return
      const rootSessionId = yield* this.dependencies.facts.hiveRootSessionId(sessionId)
      yield* this.settleRoot(rootSessionId, occurredAt)
    })
  }

  /** Re-checks every held Ready to read, for a Hive that settled without a Run settling. */
  settleHeld(at: number) {
    return Effect.forEach(
      [...this.held.keys()],
      (rootSessionId) => this.settleRoot(rootSessionId, at),
      {
        discard: true,
      },
    )
  }

  /**
   * Shows the root's held Ready to read once nothing runs in its Hive and no Hive wake is coming,
   * once: it is forgotten as it is shown. It carries the time the Hive settled, so a visit while
   * Workers still ran does not count as having read it.
   */
  settleRoot(rootSessionId: string, occurredAt: number) {
    return Effect.gen(this, function* () {
      const held = this.held.get(rootSessionId)
      if (!held) return
      const { facts } = this.dependencies
      const work = yield* facts.hiveActivity(rootSessionId, null)
      if (this.held.get(rootSessionId) !== held) return
      if (!readyToReadHiveSettled(work) && !this.wakeOverdue(rootSessionId, work, occurredAt))
        return
      this.held.delete(rootSessionId)
      this.wakeExpectedSince.delete(rootSessionId)
      const session = yield* facts.session(rootSessionId)
      if (!session || session.archived || session.parentSessionId !== null) return
      yield* this.show(session, held.preview, Math.max(occurredAt, held.occurredAt))
    })
  }

  /**
   * Whether a Hive wake was expected for longer than any wake takes to start while nothing ran. A
   * wake the Host refused for a reason the facts do not repeat leaves its update pending, so the
   * Hive would look as if a wake were still coming forever.
   */
  private wakeOverdue(rootSessionId: string, work: DesktopNotificationHiveActivity, at: number) {
    if (work.rootRunning || work.workersRunning || !work.wakeComing) {
      this.wakeExpectedSince.delete(rootSessionId)
      return false
    }
    const since = this.wakeExpectedSince.get(rootSessionId)
    if (since === undefined) {
      this.wakeExpectedSince.set(rootSessionId, at)
      return false
    }
    return at - since >= HIVE_WAKE_START_GRACE_MS
  }

  private show(session: DesktopNotificationSessionFacts, preview: string | null, at: number) {
    return this.dependencies.ledger.show({
      target: sessionNotificationTarget(session.sessionId),
      candidate: READY_TO_READ,
      subject: { sessionId: session.sessionId, projectPath: session.projectPath },
      title: session,
      preview,
      occurredAt: at,
    })
  }
}
