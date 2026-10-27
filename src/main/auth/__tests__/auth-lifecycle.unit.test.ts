import { AUTH_TIMEOUT } from '@shared/constants/time'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runGuiEffect: vi.fn(async () => [] as readonly { provider: string; connected: boolean }[]),
}))

vi.mock('../../gui-runtime', () => ({ runGuiEffect: mocks.runGuiEffect }))
vi.mock('../../desktop-ui', () => ({ openExternal: vi.fn(async () => undefined) }))

const { startAuthLifecycle } = await import('../index')

/*
 * The lifecycle's check loads Pi and builds a model runtime in the window process. At startup
 * that sat on the window's main thread while it opened (W11); the window lists the accounts
 * itself once Settings load, so the first check waits until it is up.
 */
describe('auth lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.runGuiEffect.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks sign-ins once the window is up, not while it opens, then on its interval', async () => {
    const stop = startAuthLifecycle(vi.fn())

    expect(mocks.runGuiEffect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_FIRST_CHECK_DELAY_MS)
    expect(mocks.runGuiEffect).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_INTERVAL_MS)
    expect(mocks.runGuiEffect).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reports a sign-in that expired between two checks', async () => {
    const emit = vi.fn()
    mocks.runGuiEffect
      .mockResolvedValueOnce([{ provider: 'anthropic', connected: true }])
      .mockResolvedValueOnce([{ provider: 'anthropic', connected: false }])
    const stop = startAuthLifecycle(emit)

    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_FIRST_CHECK_DELAY_MS)
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_INTERVAL_MS)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', provider: 'anthropic' }),
    )
    stop()
  })

  it('cancels a first check that has not run when stopped', async () => {
    const stop = startAuthLifecycle(vi.fn())
    stop()

    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_INTERVAL_MS)

    expect(mocks.runGuiEffect).not.toHaveBeenCalled()
  })

  it('starts over on a second start instead of running two schedules', async () => {
    startAuthLifecycle(vi.fn())
    const stop = startAuthLifecycle(vi.fn())

    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT.LIFECYCLE_FIRST_CHECK_DELAY_MS)

    expect(mocks.runGuiEffect).toHaveBeenCalledOnce()
    stop()
  })
})
