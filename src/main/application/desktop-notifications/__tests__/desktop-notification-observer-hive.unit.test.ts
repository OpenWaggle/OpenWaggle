import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  AGENT,
  approvalRequest,
  PERSON,
  replied,
  session,
  settled,
  setup,
  shownKinds,
} from './desktop-notification-observer.test-harness'

const person = { originCallerId: PERSON, scheduledTaskPolicy: null }

/** A Queen (`root`) with Workers `w1` and `w2`, and `w3` spawned by `w1`. */
function hive(overrides: Parameters<typeof setup>[0] = {}) {
  return setup({
    sessions: {
      root: session('root', { title: 'Queen' }),
      w1: session('w1', { parentSessionId: 'root', parentTitle: 'Queen' }),
      w2: session('w2', { parentSessionId: 'root', parentTitle: 'Queen' }),
      w3: session('w3', { parentSessionId: 'w1', parentTitle: 'Title w1' }),
    },
    parents: { w1: 'root', w2: 'root', w3: 'w1' },
    runs: {
      'run-1': person,
      'run-2': person,
      // A Hive wake acts for the caller of the Queen's latest Run: here the person.
      'wake-1': person,
      'wake-2': person,
      'w1-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      'w2-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      'w3-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
    },
    ...overrides,
  })
}

function workerSettled(sessionId: string, status: 'completed' | 'failed' = 'completed') {
  return settled(`${sessionId}-run`, status, { sessionId })
}

describe('DesktopNotificationObserver: Ready to read waits for the work (ADR 0063)', () => {
  it('does not notify a Queen that delegated and ended her turn', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1', 'w2'])
    await emit(replied('root', 'I will report back when the Workers are done.'))
    await emit(settled('run-1', 'completed'), 100)
    expect(published).toEqual([])
  })

  it('does not notify for a wake while Workers still run, then once after the last wake', async () => {
    const { emit, published, ledger, fixture } = hive({
      preferences: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, showPreviews: true },
    })
    fixture.running = new Set(['w1', 'w2'])
    await emit(settled('run-1', 'completed'), 100)

    // w1 reports; the Host will wake the Queen for it.
    fixture.running.delete('w1')
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])

    // The wake reads w1's result while w2 still runs.
    fixture.wakeComing.delete('root')
    await emit(replied('root', 'w1 is done, waiting for w2.'))
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 120)
    expect(published).toEqual([])

    fixture.running.delete('w2')
    fixture.wakeComing.add('root')
    await emit(workerSettled('w2'), 130)
    expect(published).toEqual([])

    // The last wake ends with nothing running: its reply is the one to read, once.
    fixture.wakeComing.delete('root')
    await emit(replied('root', 'Both Workers are done.'))
    await emit(settled('wake-2', 'completed', { hiveWake: true }), 140)
    await emit(workerSettled('w1'), 150)
    expect(shownKinds(published)).toEqual(['shown:completed'])
    expect(ledger.list()[0]).toMatchObject({ preview: 'Both Workers are done.', createdAt: 140 })
  })

  it('notifies once on the last Worker settlement when no wake is coming', async () => {
    const { emit, published, ledger, fixture } = hive()
    fixture.running = new Set(['w1', 'w2'])
    await emit(settled('run-1', 'completed'), 100)

    fixture.running.delete('w1')
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])

    // The Queen is blocked (the person stopped her, or her caller lost its authority).
    fixture.running.delete('w2')
    await emit(workerSettled('w2', 'failed'), 120)
    await emit(workerSettled('w2'), 130)
    expect(shownKinds(published)).toEqual(['shown:completed'])
    expect(ledger.list()[0]).toMatchObject({ title: 'Queen · openwaggle', createdAt: 120 })
  })

  it('waits for Workers at any depth', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w3'])
    await emit(settled('run-1', 'completed'), 100)
    expect(published).toEqual([])

    fixture.running.clear()
    await emit(workerSettled('w3'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it("answers the person's mid-work question at once, and the original request later", async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)

    // The person asks how it is going while w1 runs.
    fixture.midWorkRuns.add('run-2')
    await emit(settled('run-2', 'completed'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])

    fixture.running.clear()
    await emit(workerSettled('w1'), 120)
    expect(shownKinds(published)).toEqual(['shown:completed', 'shown:completed'])
  })

  it('does not treat a wake as a mid-work question', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    fixture.midWorkRuns.add('wake-1')
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 100)
    expect(published).toEqual([])
  })

  it('notifies at once when nothing below the Session runs', async () => {
    const { emit, published } = hive()
    await emit(settled('run-1', 'completed'), 100)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('still notifies a reply the person had already visited before the Workers finished', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.visits.root = 105
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('never makes Needs you or Failed or interrupted wait', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(approvalRequest('root'))
    await emit(settled('run-1', 'failed'), 100)
    expect(shownKinds(published)).toEqual(['shown:awaiting-approval'])

    const failed = hive()
    failed.fixture.running = new Set(['w1'])
    await failed.emit(settled('run-1', 'completed'), 100)
    await failed.emit(settled('run-2', 'failed'), 110)
    // The failure is what the person reads; the held Ready to read is dropped with it.
    failed.fixture.running.clear()
    await failed.emit(workerSettled('w1'), 120)
    expect(shownKinds(failed.published)).toEqual(['shown:failed'])
  })

  it('keeps a failures-only Scheduled task silent, Workers or not', async () => {
    const { emit, published, fixture } = hive({
      runs: { 'run-1': { originCallerId: AGENT, scheduledTaskPolicy: 'failures-only' } },
    })
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])
  })

  it('drops a held Ready to read when its Session is archived', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    await emit(
      fromPartial<SessionHostEventPayload>({
        kind: 'session-list-changed',
        sessionId: 'root',
        change: 'archived',
      }),
    )
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])
  })

  it('shows a held Ready to read when an archived Worker completes last', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    const w1 = fixture.sessions.w1
    if (!w1) throw new Error('Expected the Worker fixture.')
    fixture.sessions.w1 = { ...w1, archived: true }
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('shows a held Ready to read once an expected Hive wake never starts', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])

    // The wake is refused; its update stays pending, so a wake still looks as if it were coming.
    await Effect.runPromise(observer.settleHeldReadyToRead(10_000, false))
    expect(published).toEqual([])
    await Effect.runPromise(observer.settleHeldReadyToRead(40_110, false))
    expect(shownKinds(published)).toEqual(['shown:completed'])

    // The wake starts after all: its request was already announced.
    fixture.wakeComing.clear()
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 50_000)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('leaves a settled Hive to the wake settlement it is still handling', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    // The wake Run completed in the database; its settlement event is still queued.
    fixture.wakeComing.clear()
    await Effect.runPromise(observer.settleHeldReadyToRead(1_000, false))
    await Effect.runPromise(observer.settleHeldReadyToRead(2_000, false))
    expect(published).toEqual([])
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 2_500)
    expect(shownKinds(published)).toEqual(['shown:completed'])
    await Effect.runPromise(observer.settleHeldReadyToRead(60_000, false))
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('announces once when the wake completed before the last Worker event was handled', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    // Observer lag: the wake already ran and completed when w1's settlement is handled.
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 120)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('keeps the held request when Failed or interrupted is turned off', async () => {
    const { emit, published, fixture } = hive({
      preferences: {
        ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
        categories: {
          ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.categories,
          'failed-or-interrupted': false,
        },
      },
    })
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    await emit(settled('run-2', 'failed'), 105)
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('never gives up on a wake that a full Run limit only defers', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    await Effect.runPromise(observer.settleHeldReadyToRead(10_000, true))
    await Effect.runPromise(observer.settleHeldReadyToRead(90_000, true))
    expect(published).toEqual([])

    fixture.wakeComing.clear()
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 95_000)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('keeps the person waiting on their request when an agent-started Run fails', async () => {
    const { emit, published, fixture } = hive({
      runs: {
        'run-1': person,
        'run-agent': { originCallerId: AGENT, scheduledTaskPolicy: null },
        'w1-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      },
    })
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    await emit(settled('run-agent', 'failed'), 105)
    expect(published).toEqual([])
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('drops the held request when the person stops the Queen', async () => {
    const { emit, published, fixture } = hive({
      runs: {
        'run-1': person,
        'run-2': { ...person, interruptedByCallerId: PERSON },
        'w1-run': { originCallerId: AGENT, scheduledTaskPolicy: null },
      },
    })
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    await emit(settled('run-2', 'interrupted'), 105)
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(published).toEqual([])
  })
})
