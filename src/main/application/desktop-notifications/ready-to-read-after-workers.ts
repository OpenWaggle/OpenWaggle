import * as Effect from 'effect/Effect'
import {
  type DesktopNotificationCandidate,
  readyToReadHiveSettled,
  readyToReadTiming,
} from '../../domain/desktop-notifications/desktop-notification-policy'
import type {
  DesktopNotificationFactsShape,
  DesktopNotificationSessionFacts,
} from '../../ports/desktop-notification-facts'
import {
  type DesktopNotificationLedger,
  sessionNotificationTarget,
} from './desktop-notification-ledger'

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

  constructor(private readonly dependencies: ReadyToReadAfterWorkersDependencies) {}

  /** The root Session's request ended another way (stopped, failed, archived or deleted). */
  drop(rootSessionId: string) {
    this.held.delete(rootSessionId)
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
      if (!readyToReadHiveSettled(work) || this.held.get(rootSessionId) !== held) return
      this.held.delete(rootSessionId)
      const session = yield* facts.session(rootSessionId)
      if (!session || session.archived || session.parentSessionId !== null) return
      yield* this.show(session, held.preview, Math.max(occurredAt, held.occurredAt))
    })
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
