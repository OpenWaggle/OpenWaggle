import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { session, setup, shownKinds } from './desktop-notification-observer.test-harness'

describe('HostStateDesktopNotifications', () => {
  it('announces a Worker that becomes Stuck once, and withdraws it when it recovers', async () => {
    const { hostState, fixture, published } = setup({
      sessions: { worker: session('worker', { parentSessionId: 'queen', parentTitle: 'Queen' }) },
    })
    fixture.stuck = ['worker']
    // The first scan only records who is Stuck.
    await Effect.runPromise(hostState.scanStuckWorkers())
    expect(published).toEqual([])

    fixture.stuck = []
    await Effect.runPromise(hostState.scanStuckWorkers())
    fixture.stuck = ['worker']
    await Effect.runPromise(hostState.scanStuckWorkers())
    await Effect.runPromise(hostState.scanStuckWorkers())
    fixture.stuck = []
    await Effect.runPromise(hostState.scanStuckWorkers())
    expect(shownKinds(published)).toEqual(['shown:stuck', 'desktop-notification-withdrawn'])
  })

  it('announces Runs lost with the previous Host as Failed or interrupted', async () => {
    const { hostState, published } = setup()
    await Effect.runPromise(hostState.notifyRunsInterruptedByHostLoss(0))
    await Effect.runPromise(hostState.notifyRunsInterruptedByHostLoss(0))
    expect(shownKinds(published)).toEqual(['shown:host-loss'])
  })

  it('announces a Scheduled task stopped for attention, but not one whose Session was archived', async () => {
    const { hostState, ledger } = setup()
    const attention = { since: 10, message: 'The creator lost access.' }
    await Effect.runPromise(
      hostState.notifyScheduledTaskAttention({
        taskId: 'task-1',
        taskName: 'Nightly build',
        kind: 'launch',
        projectPath: '/work/openwaggle',
        targetSessionId: null,
        attention: fromPartial({ ...attention, reason: 'creator-authority-revoked' }),
      }),
    )
    await Effect.runPromise(
      hostState.notifyScheduledTaskAttention({
        taskId: 'task-2',
        taskName: 'Heartbeat',
        kind: 'heartbeat',
        projectPath: '/work/openwaggle',
        targetSessionId: 'root',
        attention: fromPartial({ ...attention, reason: 'target-session-archived' }),
      }),
    )
    expect(ledger.list()).toEqual([
      expect.objectContaining({
        target: { kind: 'scheduled-task', taskId: 'task-1' },
        title: 'Nightly build · openwaggle',
        category: 'failed-or-interrupted',
      }),
    ])
  })
})
