import { describe, expect, it, vi } from 'vitest'
import {
  FollowUpEditHoldWindowLeases,
  type WindowFollowUpEditHold,
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

  it('renews tracked holds and stops renewing holds the Host lost', async () => {
    const { leases, dependencies, ticks, stopped } = harness(false)
    leases.track(7, HOLD)

    ticks[0]?.()
    await vi.waitFor(() => expect(dependencies.renew).toHaveBeenCalledWith(HOLD))
    await vi.waitFor(() => expect(leases.heldBy(7)).toEqual([]))
    expect(stopped).toHaveBeenCalled()
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
