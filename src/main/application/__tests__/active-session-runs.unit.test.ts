import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeRuns,
  cancelAllSessionRuns,
  claimSessionWriterSuccessorAndWait,
  interruptExactSessionRun,
  interruptSessionWriterAndWait,
  releaseClaimedSessionWriterSuccessor,
  reserveActiveSessionRun,
  reserveCompactionSessionWriter,
  reserveSessionTreeMutation,
  reserveWaggleSessionWriter,
} from '../active-session-runs'

describe('active Session Runs', () => {
  afterEach(() => cancelAllSessionRuns())

  it('waits for the exact interrupted Run to finish cleanup', async () => {
    const sessionId = SessionId('session-target')
    const controller = new AbortController()
    const abort = vi.spyOn(controller, 'abort')
    activeRuns.register(sessionId, controller, {
      model: SupportedModelId('provider/model'),
      runId: 'run-active',
    })

    await expect(interruptExactSessionRun(sessionId, 'run-stale')).resolves.toBe(false)
    expect(abort).not.toHaveBeenCalled()
    expect(activeRuns.has(sessionId)).toBe(true)

    let interruptionSettled = false
    const interruption = interruptExactSessionRun(sessionId, 'run-active').then((accepted) => {
      interruptionSettled = true
      return accepted
    })
    await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce())
    expect(interruptionSettled).toBe(false)
    expect(activeRuns.has(sessionId)).toBe(true)

    expect(activeRuns.deleteIfCurrent(sessionId, controller)).toBe(true)
    await expect(interruption).resolves.toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    expect(activeRuns.has(sessionId)).toBe(false)
  })

  it('admits only one Pi writer across classic, Waggle, compaction, and tree mutation', () => {
    const sessionId = SessionId('session-exclusive')
    const run = reserveActiveSessionRun(sessionId, 'run-active')

    expect(() =>
      reserveCompactionSessionWriter(
        sessionId,
        new AbortController(),
        SupportedModelId('provider/model'),
      ),
    ).toThrow('active classic Pi writer')
    expect(() =>
      reserveWaggleSessionWriter(sessionId, new AbortController(), 'waggle-run'),
    ).toThrow('active classic Pi writer')
    expect(() => reserveSessionTreeMutation(sessionId)).toThrow('active classic Pi writer')

    run.release()
    const tree = reserveSessionTreeMutation(sessionId)
    expect(() => reserveActiveSessionRun(sessionId, 'run-next')).toThrow(
      'active tree-mutation Pi writer',
    )
    tree.release()
  })

  it('does not admit a replacement writer until interrupted cleanup settles', async () => {
    const sessionId = SessionId('session-replacement')
    const waggleController = new AbortController()
    const waggle = reserveWaggleSessionWriter(sessionId, waggleController, 'waggle-run')
    let interruptionSettled = false

    const interruption = interruptSessionWriterAndWait(sessionId).then((interrupted) => {
      interruptionSettled = true
      return interrupted
    })
    await vi.waitFor(() => expect(waggleController.signal.aborted).toBe(true))
    expect(interruptionSettled).toBe(false)
    expect(() => reserveActiveSessionRun(sessionId, 'run-too-early')).toThrow(
      'active waggle Pi writer',
    )

    waggle.release()
    await expect(interruption).resolves.toBe(true)
    const replacement = reserveActiveSessionRun(sessionId, 'run-replacement')
    replacement.release()
  })

  it('holds the writer slot for a claimed Waggle successor across old Run cleanup', async () => {
    const sessionId = SessionId('session-successor')
    const classic = reserveActiveSessionRun(sessionId, 'run-active')
    const claimed = claimSessionWriterSuccessorAndWait(sessionId, 'waggle')

    await vi.waitFor(() => expect(classic.controller.signal.aborted).toBe(true))
    expect(() => reserveActiveSessionRun(sessionId, 'run-racer')).toThrow(
      'active classic Pi writer',
    )
    classic.release()
    const token = await claimed
    expect(token).not.toBeNull()
    expect(() => reserveActiveSessionRun(sessionId, 'run-racer')).toThrow(
      'active classic Pi writer',
    )

    const waggle = reserveWaggleSessionWriter(
      sessionId,
      new AbortController(),
      'waggle-successor',
      token ?? undefined,
    )
    waggle.release()
  })

  it('releases an abandoned Waggle successor claim for later writers', async () => {
    const sessionId = SessionId('session-abandoned-successor')
    const classic = reserveActiveSessionRun(sessionId, 'run-active')
    const claimed = claimSessionWriterSuccessorAndWait(sessionId, 'waggle')

    await vi.waitFor(() => expect(classic.controller.signal.aborted).toBe(true))
    classic.release()
    const token = await claimed
    expect(token).not.toBeNull()
    if (!token) {
      return
    }

    expect(releaseClaimedSessionWriterSuccessor(sessionId, token)).toBe(true)
    const later = reserveActiveSessionRun(sessionId, 'run-later')
    later.release()
  })
})
