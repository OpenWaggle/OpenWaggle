import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  AGENT,
  approvalRequest,
  replied,
  settled,
  shownKinds,
} from './desktop-notification-observer.test-harness'
import { hive, workerSettled } from './desktop-notification-observer-hive.test-support'

describe('DesktopNotificationObserver: Ready to read waits for the work (ADR 0065)', () => {
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
})
