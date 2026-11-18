import { SessionId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelAllSessionRuns,
  reserveActiveSessionRun,
  reserveWaggleSessionWriter,
} from '../active-session-runs'
import { isSessionRunLive, waitForSessionRunEnd } from '../session-run-end'

describe('waiting for one Run of a Session to end', () => {
  afterEach(() => cancelAllSessionRuns())

  it('resolves when the named Run releases, without cancelling it', async () => {
    const sessionId = SessionId('self-archive-run')
    const run = reserveActiveSessionRun(sessionId, 'run-asking')
    let ended = false
    const waiting = waitForSessionRunEnd(sessionId, 'run-asking').then(() => {
      ended = true
    })

    expect(isSessionRunLive(sessionId, 'run-asking')).toBe(true)
    expect(isSessionRunLive(sessionId, 'run-other')).toBe(false)
    await Promise.resolve()
    expect(ended).toBe(false)
    expect(run.controller.signal.aborted).toBe(false)

    run.release()
    await waiting
    expect(isSessionRunLive(sessionId, 'run-asking')).toBe(false)
    // A Run that is no longer live resolves at once.
    await expect(waitForSessionRunEnd(sessionId, 'run-asking')).resolves.toBeUndefined()
  })

  it('waits for a Waggle Run that holds the writer under its own Run id', async () => {
    const sessionId = SessionId('self-archive-waggle')
    const waggle = reserveWaggleSessionWriter(sessionId, new AbortController(), 'run-waggle')
    let ended = false
    const waiting = waitForSessionRunEnd(sessionId, 'run-waggle').then(() => {
      ended = true
    })

    expect(isSessionRunLive(sessionId, 'run-waggle')).toBe(true)
    await Promise.resolve()
    expect(ended).toBe(false)
    waggle.release()
    await waiting
    expect(isSessionRunLive(sessionId, 'run-waggle')).toBe(false)
  })
})
