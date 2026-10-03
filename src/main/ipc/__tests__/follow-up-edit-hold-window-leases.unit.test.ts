import { describe, expect, it, vi } from 'vitest'
import {
  FollowUpEditHoldWindowLeases,
  type WindowFollowUpEditHold,
  WindowPageGenerations,
} from '../follow-up-edit-hold-window-leases'

const HOLD: WindowFollowUpEditHold = {
  sessionId: 'session-1',
  followUpId: 'follow-up-1',
  holdId: 'hold-1',
}

function harness(renewed = true) {
  const goneCallbacks = new Map<number, () => void>()
  const ticks: (() => void)[] = []
  const stopped = vi.fn()
  const dependencies = {
    renew: vi.fn(async () => renewed),
    release: vi.fn(async () => undefined),
    watchWindow: vi.fn((windowId: number, onGone: () => void) => {
      goneCallbacks.set(windowId, onGone)
    }),
    repeat: vi.fn((callback: () => void) => {
      ticks.push(callback)
      return stopped
    }),
  }
  const leases = new FollowUpEditHoldWindowLeases(dependencies)
  return { leases, dependencies, goneCallbacks, ticks, stopped }
}

describe('FollowUpEditHoldWindowLeases', () => {
  it('releases a window’s holds when that window is gone', async () => {
    const { leases, dependencies, goneCallbacks } = harness()
    leases.track(7, HOLD)
    leases.track(7, { ...HOLD, followUpId: 'follow-up-2', holdId: 'hold-2' })
    leases.track(8, { ...HOLD, holdId: 'hold-3' })

    goneCallbacks.get(7)?.()
    await vi.waitFor(() => expect(dependencies.release).toHaveBeenCalledTimes(2))

    expect(dependencies.release).toHaveBeenCalledWith(HOLD)
    expect(leases.heldBy(7)).toEqual([])
    expect(leases.heldBy(8)).toHaveLength(1)
    expect(dependencies.watchWindow).toHaveBeenCalledTimes(2)
  })

  it('renews tracked holds, and cancels a hold the Host lost so its queue can deliver', async () => {
    const { leases, dependencies, ticks, stopped } = harness(false)
    leases.track(7, HOLD)

    ticks[0]?.()
    await vi.waitFor(() => expect(dependencies.renew).toHaveBeenCalledWith(HOLD))
    await vi.waitFor(() => expect(dependencies.release).toHaveBeenCalledWith(HOLD))
    expect(leases.heldBy(7)).toEqual([])
    expect(stopped).toHaveBeenCalled()
  })

  it('moves a live hold to the window that adopts it', async () => {
    const { leases, goneCallbacks, dependencies } = harness()
    leases.track(7, HOLD)

    expect(await leases.adopt(8, HOLD, () => true)).toBe(true)
    expect(leases.heldBy(7)).toEqual([])
    expect(leases.heldBy(8)).toEqual([HOLD])
    // Closing the window that began the edit no longer releases it.
    goneCallbacks.get(7)?.()
    expect(dependencies.release).not.toHaveBeenCalled()
    goneCallbacks.get(8)?.()
    await vi.waitFor(() => expect(dependencies.release).toHaveBeenCalledWith(HOLD))
  })

  it('does not adopt a hold the Host lost, or into a page that changed meanwhile', async () => {
    const lost = harness(false)
    lost.leases.track(7, HOLD)
    expect(await lost.leases.adopt(8, HOLD, () => true)).toBe(false)
    expect(lost.leases.heldBy(7)).toEqual([])

    const reloaded = harness()
    reloaded.leases.track(7, HOLD)
    expect(await reloaded.leases.adopt(8, HOLD, () => false)).toBe(false)
    expect(reloaded.leases.heldBy(7)).toEqual([HOLD])
  })

  it('keeps renewing a hold the Host still has', async () => {
    const { leases, dependencies } = harness(true)
    leases.track(7, HOLD)

    await leases.renewAll()
    expect(dependencies.release).not.toHaveBeenCalled()
    expect(leases.heldBy(7)).toEqual([HOLD])
  })

  it('keeps a hold through a transient renewal failure', async () => {
    const { leases, dependencies } = harness()
    dependencies.renew.mockRejectedValueOnce(new Error('Host unavailable'))
    leases.track(7, HOLD)

    await leases.renewAll()
    expect(leases.heldBy(7)).toEqual([HOLD])
  })

  it('stops tracking a saved or cancelled hold without releasing it again', async () => {
    const { leases, dependencies, goneCallbacks, stopped } = harness()
    leases.track(7, HOLD)
    leases.forget(HOLD.holdId)
    expect(stopped).toHaveBeenCalled()

    goneCallbacks.get(7)?.()
    await Promise.resolve()
    expect(dependencies.release).not.toHaveBeenCalled()
  })

  it('watches a window again after it reloaded', () => {
    const { leases, dependencies, goneCallbacks } = harness()
    leases.track(7, HOLD)
    goneCallbacks.get(7)?.()
    leases.track(7, { ...HOLD, holdId: 'hold-after-reload' })
    expect(dependencies.watchWindow).toHaveBeenCalledTimes(2)
  })
})

describe('WindowPageGenerations', () => {
  function generations() {
    const events = new Map<number, { pageChanged: () => void; destroyed: () => void }>()
    const tracker = new WindowPageGenerations((windowId, windowEvents) => {
      if (windowId === 99) return false
      events.set(windowId, windowEvents)
      return true
    })
    return { tracker, events }
  }

  it('keeps a begin bound to its page while the page stays loaded', () => {
    const { tracker } = generations()
    const generation = tracker.snapshot(7)
    expect(tracker.isCurrent(7, generation)).toBe(true)
  })

  it('reports a page that reloaded, crashed, or closed during the begin as gone', () => {
    const { tracker, events } = generations()
    const reloaded = tracker.snapshot(7)
    events.get(7)?.pageChanged()
    expect(tracker.isCurrent(7, reloaded)).toBe(false)

    const closing = tracker.snapshot(8)
    events.get(8)?.destroyed()
    expect(tracker.isCurrent(8, closing)).toBe(false)
    expect(tracker.isCurrent(99, tracker.snapshot(99))).toBe(false)
  })
})
