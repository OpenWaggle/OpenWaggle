import * as Effect from 'effect/Effect'
import {
  type DesktopNotificationCandidate,
  type DesktopNotificationRunOrigin,
  desktopNotificationOriginOfCaller,
  desktopNotificationOriginPermits,
  readyToReadHiveSettled,
  readyToReadTiming,
} from '../../domain/desktop-notifications/desktop-notification-policy'
import type {
  DesktopNotificationFactsShape,
  DesktopNotificationRunFacts,
  DesktopNotificationSessionFacts,
} from '../../ports/desktop-notification-facts'
import {
  type DesktopNotificationLedger,
  sessionNotificationTarget,
} from './desktop-notification-ledger'

/** How long a Hive may wait for an expected wake to start before its Ready to read shows. */
const HIVE_WAKE_START_GRACE_MS = 30_000
/** How long the sweep leaves a settled Hive to the Run settlement event that announces it. */
const SETTLED_SWEEP_GRACE_MS = 10_000

/** Who a Run acts for, as notifications judge it. */
export function originOfRun(run: DesktopNotificationRunFacts | null): DesktopNotificationRunOrigin {
  if (!run) return { kind: 'person' }
  if (run.scheduledTaskPolicy !== null) {
    return { kind: 'scheduled-task', policy: run.scheduledTaskPolicy }
  }
  return desktopNotificationOriginOfCaller(run.originCallerId)
}

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
  /** When the sweep first saw nothing running in a held root's Hive. */
  private readonly quietSince = new Map<string, number>()
  /** Roots whose held Ready to read the sweep showed, before any wake Run said so. */
  private readonly shownBySweep = new Set<string>()

  constructor(private readonly dependencies: ReadyToReadAfterWorkersDependencies) {}

  /** The root Session's request ended another way (stopped, failed, archived or deleted). */
  drop(rootSessionId: string) {
    this.held.delete(rootSessionId)
    this.quietSince.delete(rootSessionId)
    this.shownBySweep.delete(rootSessionId)
  }

  /**
   * A root Run that did not complete ends the request it served when the person stopped it, or
   * when Failed or interrupted tells them, which a held Ready to read would only replace. A Run an
   * agent started or stopped tells the person nothing, so their held request keeps waiting.
   */
  ended(sessionId: string, runId: string, candidate: DesktopNotificationCandidate | null) {
    return Effect.gen(this, function* () {
      if (!this.held.has(sessionId)) return
      const run = yield* this.dependencies.facts.run(sessionId, runId)
      const stoppedBy = run?.interruptedByCallerId ?? null
      const personKnows =
        candidate === null
          ? stoppedBy === null || desktopNotificationOriginOfCaller(stoppedBy).kind === 'person'
          : desktopNotificationOriginPermits(originOfRun(run), candidate)
      if (personKnows) this.drop(sessionId)
    })
  }

  /** The origin and settings checks passed for `run`, a completed Run of the root `session`. */
  completed(session: DesktopNotificationSessionFacts, run: CompletedRootRun) {
    return Effect.gen(this, function* () {
      const work = yield* this.dependencies.facts.hiveActivity(run.sessionId, run.runId)
      const timing = readyToReadTiming(work, { hiveWake: run.hiveWake })
      // The sweep already announced this request; the wake that served it says nothing more.
      const announced = this.shownBySweep.delete(run.sessionId)
      if (announced && run.hiveWake && timing === 'now') return
      if (timing === 'after-workers') {
        this.quietSince.delete(run.sessionId)
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
   * Re-checks every held Ready to read, for a Hive that settled without a Run settling to say so.
   * A wake the Host refused for a reason the facts do not repeat (draining, the pi CLI wrote last,
   * a deferred wake dropped) leaves its update pending, so the Hive looks as if a wake were still
   * coming forever. The sweep waits out the observer's own lag first, so a Run that just settled
   * is announced by its event, and while the Host's Run limit is full a wake is only deferred.
   */
  settleHeld(at: number, runLimitFull: boolean) {
    return Effect.forEach(
      [...this.held.keys()],
      (rootSessionId) => this.sweepRoot(rootSessionId, at, runLimitFull),
      { discard: true },
    )
  }

  /** Whether any Ready to read is held, so the sweep has anything to do. */
  get holding() {
    return this.held.size > 0
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
      const work = yield* this.dependencies.facts.hiveActivity(rootSessionId, null)
      if (this.held.get(rootSessionId) !== held || !readyToReadHiveSettled(work)) return
      yield* this.showHeld(rootSessionId, held, occurredAt)
    })
  }

  private sweepRoot(rootSessionId: string, at: number, runLimitFull: boolean) {
    return Effect.gen(this, function* () {
      const held = this.held.get(rootSessionId)
      if (!held) return
      const work = yield* this.dependencies.facts.hiveActivity(rootSessionId, null)
      if (this.held.get(rootSessionId) !== held) return
      if (work.rootRunning || work.workersRunning || (work.wakeComing && runLimitFull)) {
        this.quietSince.delete(rootSessionId)
        return
      }
      const since = this.quietSince.get(rootSessionId)
      if (since === undefined) {
        this.quietSince.set(rootSessionId, at)
        return
      }
      const grace = work.wakeComing ? HIVE_WAKE_START_GRACE_MS : SETTLED_SWEEP_GRACE_MS
      if (at - since < grace) return
      // A wake that completes after all was already announced by this notification.
      this.shownBySweep.add(rootSessionId)
      yield* this.showHeld(rootSessionId, held, at)
    })
  }

  private showHeld(rootSessionId: string, held: HeldReadyToRead, at: number) {
    return Effect.gen(this, function* () {
      this.held.delete(rootSessionId)
      this.quietSince.delete(rootSessionId)
      const session = yield* this.dependencies.facts.session(rootSessionId)
      if (!session || session.archived || session.parentSessionId !== null) return
      yield* this.show(session, held.preview, Math.max(at, held.occurredAt))
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
