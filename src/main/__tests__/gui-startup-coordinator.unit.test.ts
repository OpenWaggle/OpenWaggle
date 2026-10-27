import type { GuiStartupStatus } from '@shared/types/gui-startup'
import { describe, expect, it, vi } from 'vitest'
import {
  createGuiStartupCoordinator,
  GUI_STARTUP_TIMEOUT_MESSAGE,
  type GuiStartupCoordinatorInput,
  type GuiStartupProgress,
  GuiStartupRestartRequiredError,
} from '../gui-startup-coordinator'

interface Attempt {
  readonly progress: GuiStartupProgress
  readonly signal: AbortSignal
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

function harness(overrides: Partial<GuiStartupCoordinatorInput> = {}) {
  const attempts: Attempt[] = []
  const published: GuiStartupStatus[] = []
  const timers: { callback: () => void; cancelled: boolean }[] = []
  const onFailure = vi.fn()
  const restart = vi.fn()
  const coordinator = createGuiStartupCoordinator({
    start: (progress, signal) =>
      new Promise<void>((resolve, reject) => {
        attempts.push({ progress, signal, resolve, reject })
      }),
    publish: (status) => published.push(status),
    onFailure,
    describeFailure: (error) => (error instanceof Error ? error.message : String(error)),
    restart,
    setTimer: (callback) => {
      const timer = { callback, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    ...overrides,
  })
  const fireDeadline = () => {
    for (const timer of timers) if (!timer.cancelled) timer.callback()
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { coordinator, attempts, published, onFailure, restart, fireDeadline, settle }
}

describe('the window startup coordinator', () => {
  it('starts in the starting state and becomes ready when the backend is up', async () => {
    const h = harness()
    expect(h.coordinator.status()).toEqual({ state: 'starting' })

    h.coordinator.run()
    await h.settle()
    h.attempts[0]?.resolve()
    await h.settle()

    expect(h.coordinator.status()).toEqual({ state: 'ready' })
    expect(h.published).toEqual([{ state: 'ready' }])
  })

  it('shows the error screen with the redacted reason when the Host fails, instead of quitting', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    const failure = new Error('Session Host database could not be opened')
    h.attempts[0]?.reject(failure)
    await h.settle()

    expect(h.coordinator.status()).toEqual({
      state: 'failed',
      reason: 'error',
      message: 'Session Host database could not be opened',
    })
    expect(h.onFailure).toHaveBeenCalledWith(failure)
  })

  it('shows the error screen once the Host is not ready in time, and still opens when it is', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    h.fireDeadline()

    expect(h.coordinator.status()).toEqual({
      state: 'failed',
      reason: 'timeout',
      message: GUI_STARTUP_TIMEOUT_MESSAGE,
    })

    h.attempts[0]?.resolve()
    await h.settle()
    expect(h.coordinator.status()).toEqual({ state: 'ready' })
  })

  it('says an update is finishing, with no deadline, while the Host hands over', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    h.attempts[0]?.progress.updating()
    h.fireDeadline()

    expect(h.coordinator.status()).toEqual({ state: 'updating' })
  })

  it('retries a failed start with a new attempt', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    h.attempts[0]?.reject(new Error('first'))
    await h.settle()

    h.coordinator.retry()
    await h.settle()
    expect(h.coordinator.status()).toEqual({ state: 'starting' })
    expect(h.attempts).toHaveLength(2)
    h.attempts[1]?.resolve()
    await h.settle()

    expect(h.coordinator.status()).toEqual({ state: 'ready' })
  })

  it('aborts a start that is past its deadline before retrying, and ignores its late result', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    h.fireDeadline()

    h.coordinator.retry()
    await h.settle()
    expect(h.attempts[0]?.signal.aborted).toBe(true)
    expect(h.attempts).toHaveLength(2)

    h.attempts[0]?.reject(new Error('aborted'))
    await h.settle()
    expect(h.coordinator.status()).toEqual({ state: 'starting' })
    expect(h.onFailure).not.toHaveBeenCalled()
  })

  it('does nothing on Retry while a start is still within its deadline', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()

    h.coordinator.retry()
    await h.settle()

    expect(h.attempts).toHaveLength(1)
    expect(h.attempts[0]?.signal.aborted).toBe(false)
  })

  it('restarts the process when the failure left nothing to retry in place', async () => {
    const h = harness()
    h.coordinator.run()
    await h.settle()
    const cause = new Error('desktop services could not attach')
    h.attempts[0]?.reject(new GuiStartupRestartRequiredError(cause))
    await h.settle()

    expect(h.onFailure).toHaveBeenCalledWith(cause)
    h.coordinator.retry()

    expect(h.restart).toHaveBeenCalledOnce()
    expect(h.attempts).toHaveLength(1)
  })

  it('never starts twice and ignores Retry once ready', async () => {
    const h = harness()
    h.coordinator.run()
    h.coordinator.run()
    await h.settle()
    h.attempts[0]?.resolve()
    await h.settle()
    h.coordinator.run()
    h.coordinator.retry()

    expect(h.attempts).toHaveLength(1)
    expect(h.coordinator.status()).toEqual({ state: 'ready' })
  })
})
