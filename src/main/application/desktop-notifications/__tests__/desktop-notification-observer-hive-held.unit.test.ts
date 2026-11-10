import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { AGENT, PERSON, settled, shownKinds } from './desktop-notification-observer.test-harness'
import { hive, person, workerSettled } from './desktop-notification-observer-hive.test-support'

describe('DesktopNotificationObserver: held Ready to read edge cases (ADR 0065)', () => {
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

    // The wake starts after all, later: its reply reads the Workers' results, so it notifies too.
    fixture.runs['wake-1'] = { ...person, startedAt: 45_000 }
    fixture.wakeComing.clear()
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 50_000)
    expect(shownKinds(published)).toEqual(['shown:completed', 'shown:completed'])
  })

  it('keeps a wake that had started before the sweep showed its request silent', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    fixture.wakeComing.clear()
    await Effect.runPromise(observer.settleHeldReadyToRead(1_000, false))
    await Effect.runPromise(observer.settleHeldReadyToRead(12_000, false))
    expect(shownKinds(published)).toEqual(['shown:completed'])
    fixture.runs['wake-1'] = { ...person, startedAt: 500 }
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 13_000)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('still notifies for a later wake after the held request was shown', async () => {
    const { emit, published, fixture } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    await emit(workerSettled('w1'), 110)
    expect(shownKinds(published)).toEqual(['shown:completed'])
    // Much later the person follows up a Worker; its result wakes the Queen.
    fixture.runs['wake-2'] = { ...person, startedAt: 90_000 }
    await emit(settled('wake-2', 'completed', { hiveWake: true }), 95_000)
    expect(shownKinds(published)).toEqual(['shown:completed', 'shown:completed'])
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
    fixture.latestRuns.root = { runId: 'wake-1', status: 'completed', hiveWake: true }
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

  it('never gives up on a Worker’s wake that a full Active Workers limit only defers', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('w1')
    await emit(workerSettled('w1'), 110)
    await Effect.runPromise(observer.settleHeldReadyToRead(10_000, true))
    await Effect.runPromise(observer.settleHeldReadyToRead(90_000, true))
    expect(published).toEqual([])

    fixture.wakeComing.clear()
    await emit(settled('wake-1', 'completed', { hiveWake: true }), 95_000)
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  // A full limit never defers a wake of the person's own Queen, so a wake the Host skipped for
  // another reason (the pi CLI wrote last) must not hold Ready to read while other Hives are busy.
  it('gives up on the person’s Queen’s wake after the grace even while Active Workers is full', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    await Effect.runPromise(observer.settleHeldReadyToRead(10_000, true))
    expect(published).toEqual([])
    await Effect.runPromise(observer.settleHeldReadyToRead(40_110, true))
    expect(shownKinds(published)).toEqual(['shown:completed'])
  })

  it('keeps waiting on an agent-made root’s wake while Active Workers is full', async () => {
    const { emit, published, fixture, observer } = hive()
    fixture.agentMade.add('root')
    fixture.running = new Set(['w1'])
    await emit(settled('run-1', 'completed'), 100)
    fixture.running.clear()
    fixture.wakeComing.add('root')
    await emit(workerSettled('w1'), 110)
    await Effect.runPromise(observer.settleHeldReadyToRead(10_000, true))
    await Effect.runPromise(observer.settleHeldReadyToRead(90_000, true))
    expect(published).toEqual([])
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
