import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireSessionRemovalFence,
  activeRuns,
  cancelSessionRuns,
  ensureSessionRunStartAllowed,
  hasAnyActiveRun,
  isSessionRemovalFenced,
  waitForSessionRuns,
} from '../active-session-runs'

describe('active session run settlement', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not report a cancelled run idle until its owning effect settles', async () => {
    vi.useFakeTimers()
    const sessionId = SessionId('settling-session')
    const controller = new AbortController()
    activeRuns.register(sessionId, controller, {
      model: SupportedModelId('openai/gpt-5.4'),
      controlRef: { current: null },
      steerTailRef: { current: Promise.resolve() },
    })

    expect(cancelSessionRuns(sessionId)).toBe(true)
    expect(hasAnyActiveRun(sessionId)).toBe(true)
    const waiting = waitForSessionRuns(sessionId, 1_000)
    let completed = false
    void waiting.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    expect(activeRuns.deleteIfCurrent(sessionId, controller)).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    await expect(waiting).resolves.toBe(true)
    expect(hasAnyActiveRun(sessionId)).toBe(false)
  })

  it('times out while a cancelled run remains unsettled', async () => {
    const sessionId = SessionId('stuck-session')
    const controller = new AbortController()
    activeRuns.register(sessionId, controller, {
      model: SupportedModelId('openai/gpt-5.4'),
      controlRef: { current: null },
      steerTailRef: { current: Promise.resolve() },
    })
    cancelSessionRuns(sessionId)

    await expect(waitForSessionRuns(sessionId, 0)).resolves.toBe(false)

    activeRuns.deleteIfCurrent(sessionId, controller)
  })

  it('rejects new work while removal owns the session and releases idempotently', async () => {
    const sessionId = SessionId('removing-session')
    const release = acquireSessionRemovalFence(sessionId)

    expect(isSessionRemovalFenced(sessionId)).toBe(true)
    expect(() => acquireSessionRemovalFence(sessionId)).toThrow('already in progress')
    await expect(Effect.runPromise(ensureSessionRunStartAllowed(sessionId))).rejects.toThrow(
      'being archived or deleted',
    )

    release()
    release()
    expect(isSessionRemovalFenced(sessionId)).toBe(false)
    await expect(
      Effect.runPromise(ensureSessionRunStartAllowed(sessionId)),
    ).resolves.toBeUndefined()
  })
})
