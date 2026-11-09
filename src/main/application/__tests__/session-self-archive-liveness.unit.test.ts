import { SessionId } from '@shared/types/brand'
import type { SessionControlMutationResponse } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SessionOrganizationRepository,
  type SessionSelfArchiveState,
} from '../../ports/session-organization-repository'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { reserveActiveSessionRun } from '../active-session-runs'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import {
  deferArchiveUntilRunEnds,
  hasPendingSelfArchive,
  withdrawSelfArchives,
} from '../session-self-archive'

const SESSION = SessionId('self-archive-liveness')
const RUN = 'run-asking'

const COMPLETED: SessionSelfArchiveState = {
  archived: false,
  activeRunId: null,
  queuedFollowUpCount: 0,
  runStatus: 'completed',
  laterRunCount: 0,
  pendingWorkerUpdateCount: 0,
}

const ARCHIVED: SessionControlMutationResponse = fromPartial({
  replayed: false,
  outcome: { operation: 'archive', effect: 'session-archived', sessionId: SESSION },
})

const releases: (() => void)[] = []

/** A Host with the asking Run live, which holds the Host open as a Run does. */
function hostWithLiveRun() {
  const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: () => {} })
  releases.push(installSessionHostEventRuntime({ eventHub: new SessionHostEventHub(), liveness }))
  const run = reserveActiveSessionRun(SESSION, RUN)
  const releaseRunHold = liveness.acquire('run')
  let ended = false
  const endRun = () => {
    if (ended) return
    ended = true
    run.release()
    releaseRunHold()
  }
  releases.push(endRun)
  return { liveness, endRun }
}

/** Asks to archive the Session from the live Run, counting the archives that ran. */
function askToArchive(state: SessionSelfArchiveState, archive = Effect.succeed(ARCHIVED)) {
  const counter = { archives: 0 }
  const asking = deferArchiveUntilRunEnds({
    sessionId: SESSION,
    runId: RUN,
    request: fromPartial({ contractVersion: 2, requestId: 'request', idempotencyKey: 'key' }),
    archive: Effect.suspend(() => {
      counter.archives += 1
      return archive
    }),
  }).pipe(
    Effect.provide(
      Layer.succeed(
        SessionOrganizationRepository,
        fromPartial({ readSelfArchiveState: () => Effect.succeed(state) }),
      ),
    ),
  )
  return { asking, counter }
}

function settled(liveness: SessionHostLiveness) {
  return Effect.runPromise(
    Effect.suspend(() =>
      !hasPendingSelfArchive(SESSION) && liveness.ownerCount('operation') === 0
        ? Effect.void
        : Effect.fail('pending'),
    ).pipe(Effect.retry(Schedule.spaced('5 millis').pipe(Schedule.upTo('5 seconds')))),
  )
}

describe('the Host hold of a deferred self-archive', () => {
  afterEach(() => {
    for (const release of releases.splice(0).reverse()) release()
    withdrawSelfArchives(SESSION)
  })

  it.each([
    { name: 'archives', state: COMPLETED, archive: Effect.succeed(ARCHIVED), archives: 1 },
    {
      name: 'skips',
      state: { ...COMPLETED, queuedFollowUpCount: 1 },
      archive: Effect.succeed(ARCHIVED),
      archives: 0,
    },
    { name: 'fails', state: COMPLETED, archive: Effect.die('removal failed'), archives: 1 },
  ])('is admitted while draining and released once it $name', async (scenario) => {
    const { liveness, endRun } = hostWithLiveRun()
    liveness.requestDrain()

    const { asking, counter } = askToArchive(scenario.state, scenario.archive)
    const response = await Effect.runPromise(asking)

    expect(response.outcome).toEqual({
      operation: 'archive',
      effect: 'session-archive-deferred',
      sessionId: SESSION,
      runId: RUN,
    })
    expect(liveness.ownerCount('operation')).toBe(1)
    endRun()
    await settled(liveness)
    expect(counter.archives).toBe(scenario.archives)
  })

  it('archives once when the Run asks, unarchives and asks again', async () => {
    const { liveness, endRun } = hostWithLiveRun()

    const first = askToArchive(COMPLETED)
    await Effect.runPromise(first.asking)
    withdrawSelfArchives(SESSION)
    const second = askToArchive(COMPLETED)
    await Effect.runPromise(second.asking)
    expect(liveness.ownerCount('operation')).toBe(2)

    endRun()
    await settled(liveness)
    expect(first.counter.archives + second.counter.archives).toBe(1)
  })
})
