import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  drainBrowserPreviewOwnerWork,
  trackBrowserPreviewOwnerWork,
} from '../browser-preview-owner-work'

describe('browser owner handoff quiescence', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for admitted work and rollback without waiting for unrelated owners', async () => {
    const pending = Promise.withResolvers<void>()
    const foreign = Promise.withResolvers<void>()
    const work = trackBrowserPreviewOwnerWork('draft:/repo', () => pending.promise)
    const foreignWork = trackBrowserPreviewOwnerWork('foreign', () => foreign.promise)
    let drained = false
    const drain = drainBrowserPreviewOwnerWork('draft:/repo').then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    pending.resolve()
    await drain
    expect(drained).toBe(true)
    foreign.resolve()
    await Promise.all([work, foreignWork])
  })

  it('bounds a stalled request without canceling its original work', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<void>()
    const work = trackBrowserPreviewOwnerWork('draft:/stalled', () => pending.promise)
    const drain = expect(drainBrowserPreviewOwnerWork('draft:/stalled')).rejects.toThrow(
      'still opening',
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await drain
    pending.resolve()
    await work
    await drainBrowserPreviewOwnerWork('draft:/stalled')
  })
})
