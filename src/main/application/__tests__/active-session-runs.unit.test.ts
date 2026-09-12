import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireSessionRemovalFence,
  activeRuns,
  cancelAllSessionRuns,
  cancelSessionRuns,
  claimSessionWriterSuccessor,
  claimSessionWriterSuccessorAndWait,
  ensureSessionRunStartAllowed,
  getAllActiveRunSessionIds,
  hasAnyActiveRun,
  interruptExactSessionRun,
  interruptSessionWriterAndWait,
  isSessionRemovalFenced,
  releaseClaimedSessionWriterSuccessor,
  requestExactSessionRunInterruption,
  reserveActiveSessionRun,
  reserveCompactionSessionWriter,
  reservePendingClassicSessionRun,
  reservePendingWaggleSessionRun,
  reserveSessionTreeMutation,
  reserveWaggleSessionWriter,
  waitForSessionRuns,
} from '../active-session-runs'
import { registerPreAdmissionWaggleAttempt } from '../pre-admission-waggle-attempts'

describe('active Session Runs', () => {
  afterEach(() => cancelAllSessionRuns())

  it('enumerates and interrupts a Waggle attempt before durable admission', () => {
    const sessionId = SessionId('session-pre-admission-waggle')
    const controller = new AbortController()
    const release = registerPreAdmissionWaggleAttempt(sessionId, controller)

    expect(getAllActiveRunSessionIds()).toContain(sessionId)
    expect(cancelSessionRuns(sessionId)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(getAllActiveRunSessionIds()).toContain(sessionId)

    release()
    expect(getAllActiveRunSessionIds()).not.toContain(sessionId)

    const shutdownController = new AbortController()
    const releaseShutdownAttempt = registerPreAdmissionWaggleAttempt(sessionId, shutdownController)
    expect(cancelAllSessionRuns()).toContain(sessionId)
    expect(shutdownController.signal.aborted).toBe(true)
    expect(getAllActiveRunSessionIds()).toContain(sessionId)
    releaseShutdownAttempt()
    expect(getAllActiveRunSessionIds()).not.toContain(sessionId)
  })

  it('retains pending Waggle ownership across global cancellation until teardown', () => {
    const sessionId = SessionId('session-global-cancelled-waggle')
    const controller = new AbortController()
    const pending = reservePendingWaggleSessionRun(sessionId, controller, 'pending-waggle')

    expect(cancelAllSessionRuns()).toContain(sessionId)
    expect(controller.signal.aborted).toBe(true)
    expect(getAllActiveRunSessionIds()).toContain(sessionId)
    expect(() =>
      reservePendingWaggleSessionRun(sessionId, new AbortController(), 'racing-waggle'),
    ).toThrow('already has a pending Waggle run')

    pending.release()
    expect(getAllActiveRunSessionIds()).not.toContain(sessionId)
  })

  it('retains pending classic ownership across cancellation until durable settlement', () => {
    const sessionId = SessionId('session-cancelled-pending-classic')
    const pending = reservePendingClassicSessionRun(sessionId, 'pending-classic')
    expect(requestExactSessionRunInterruption(sessionId, 'other-run')).toBe(false)
    expect(pending.controller.signal.aborted).toBe(false)

    expect(cancelAllSessionRuns()).toContain(sessionId)
    expect(pending.controller.signal.aborted).toBe(true)
    expect(getAllActiveRunSessionIds()).toContain(sessionId)
    expect(hasAnyActiveRun(sessionId)).toBe(true)
    expect(() => reservePendingClassicSessionRun(sessionId, 'racing-classic')).toThrow(
      'already has a pending classic run',
    )

    pending.release()
    expect(getAllActiveRunSessionIds()).not.toContain(sessionId)
    expect(hasAnyActiveRun(sessionId)).toBe(false)
  })

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

  it('requests an exact interruption without waiting for Run cleanup', () => {
    const sessionId = SessionId('session-request-only')
    const run = reserveActiveSessionRun(sessionId, 'run-active')

    expect(requestExactSessionRunInterruption(sessionId, 'run-stale')).toBe(false)
    expect(run.controller.signal.aborted).toBe(false)
    expect(requestExactSessionRunInterruption(sessionId, 'run-active')).toBe(true)
    expect(run.controller.signal.aborted).toBe(true)
    expect(activeRuns.has(sessionId)).toBe(true)

    run.release()
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

  it('queues a classic successor behind compaction without interrupting it', async () => {
    const sessionId = SessionId('session-compaction-successor')
    const compactionController = new AbortController()
    const compaction = reserveCompactionSessionWriter(
      sessionId,
      compactionController,
      SupportedModelId('provider/model'),
    )

    const claimed = claimSessionWriterSuccessor(sessionId, 'classic')

    expect(claimed).not.toBeNull()
    expect(compactionController.signal.aborted).toBe(false)
    expect(() => reserveActiveSessionRun(sessionId, 'run-racer')).toThrow(
      'active compaction Pi writer',
    )

    compaction.release()
    await claimed?.settled
    const successor = reserveActiveSessionRun(sessionId, 'run-after-compaction', claimed?.token)
    successor.release()
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
      runId: 'run-settling',
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
      runId: 'run-stuck',
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
    expect(() => reserveActiveSessionRun(sessionId, 'blocked-classic')).toThrow(
      'being archived or deleted',
    )
    expect(() =>
      reserveCompactionSessionWriter(sessionId, new AbortController(), SupportedModelId('model')),
    ).toThrow('being archived or deleted')
    expect(() =>
      reserveWaggleSessionWriter(sessionId, new AbortController(), 'blocked-waggle'),
    ).toThrow('being archived or deleted')
    expect(() => reservePendingClassicSessionRun(sessionId, 'blocked-pending')).toThrow(
      'being archived or deleted',
    )
    expect(() =>
      reservePendingWaggleSessionRun(sessionId, new AbortController(), 'blocked-pending-waggle'),
    ).toThrow('being archived or deleted')
    expect(() => reserveSessionTreeMutation(sessionId)).toThrow('being archived or deleted')

    release()
    release()
    expect(isSessionRemovalFenced(sessionId)).toBe(false)
    await expect(
      Effect.runPromise(ensureSessionRunStartAllowed(sessionId)),
    ).resolves.toBeUndefined()
  })

  it('waits for pending and pre-admission work to release ownership after interruption', async () => {
    const sessionId = SessionId('pending-teardown')
    const pending = reservePendingClassicSessionRun(sessionId, 'pending-classic')
    const releaseAttempt = registerPreAdmissionWaggleAttempt(sessionId, new AbortController())
    cancelSessionRuns(sessionId)
    await expect(waitForSessionRuns(sessionId, 0)).resolves.toBe(false)
    pending.release()
    await expect(waitForSessionRuns(sessionId, 0)).resolves.toBe(false)
    releaseAttempt()
    await expect(waitForSessionRuns(sessionId, 0)).resolves.toBe(true)
  })

  it('preserves exact-run waiters across a metadata refresh', async () => {
    const sessionId = SessionId('metadata-refresh')
    const controller = new AbortController()
    activeRuns.register(sessionId, controller, { runId: 'same-run' })
    const interrupted = interruptExactSessionRun(sessionId, 'same-run')
    activeRuns.register(sessionId, controller, {
      runId: 'same-run',
      model: SupportedModelId('model'),
    })
    activeRuns.deleteIfCurrent(sessionId, controller)
    await expect(interrupted).resolves.toBe(true)
  })
})
