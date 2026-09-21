import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireLeaseMock,
  activateMock,
  attachmentCleanupMock,
  attachmentResolveMock,
  executeWaggleRunMock,
  emitWorktreeLaunchProgressMock,
  forkSupervisedMock,
  journalClaimMock,
  journalCompleteMock,
  prepareMock,
  requestHostDrainMock,
  settleMock,
} = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  activateMock: vi.fn(),
  attachmentCleanupMock: vi.fn(),
  attachmentResolveMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
  emitWorktreeLaunchProgressMock: vi.fn(),
  forkSupervisedMock: vi.fn(),
  journalClaimMock: vi.fn(),
  journalCompleteMock: vi.fn(),
  prepareMock: vi.fn(),
  requestHostDrainMock: vi.fn(),
  settleMock: vi.fn(),
}))

vi.mock('../session-host-run-admission', () => ({
  acquireSessionHostRunLease: acquireLeaseMock,
}))

vi.mock('../session-external-run-coordinator', () => ({
  activatePreparedExternalSessionRun: activateMock,
  prepareExternalSessionRunReplacement: prepareMock,
  settleExternalSessionRun: settleMock,
}))

vi.mock('../waggle-run-service', () => ({ executeWaggleRun: executeWaggleRunMock }))
vi.mock('../session-control-run-coordinator', () => ({
  coordinateSessionRuns: vi.fn(() => Effect.void),
}))
vi.mock('../session-run-coordinator-supervision', () => ({
  forkSupervisedSessionRuns: forkSupervisedMock,
}))
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: vi.fn(),
  tryGetSessionHostEventRuntime: vi.fn(() => ({
    liveness: { requestDrain: requestHostDrainMock },
  })),
}))
vi.mock('../../utils/stream-bridge', () => ({
  emitWorktreeLaunchFailure: vi.fn(),
  emitWorktreeLaunchProgress: emitWorktreeLaunchProgressMock,
}))

import { ExplicitWaggleOperationJournal } from '../../ports/explicit-waggle-operation-journal'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import {
  activeWaggleRuns,
  cancelAllSessionRuns,
  reserveActiveSessionRun,
} from '../active-session-runs'
import {
  cancelLocalExplicitWaggle,
  executeExplicitWaggleCommand,
} from '../explicit-waggle-command-service'

const SESSION_ID = SessionId('session-lifecycle')
const attachmentService = SessionControlAttachmentService.of({
  prepare: () => Effect.die('unused'),
  bind: () => Effect.die('unused'),
  cleanupUnreferenced: attachmentCleanupMock,
  resolve: attachmentResolveMock,
  release: () => Effect.die('unused'),
})
const operationJournal = ExplicitWaggleOperationJournal.of({
  claim: journalClaimMock,
  complete: journalCompleteMock,
})

function waggleCommand(withAttachment = false, hostRunCeiling?: number, operationSuffix = '1') {
  const payload: Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }> = {
    contract: 'session-waggle-v1',
    request: {
      contractVersion: 1,
      requestId: `request-${operationSuffix}`,
      idempotencyKey: `idempotency-${operationSuffix}`,
      sessionId: SESSION_ID,
      payload: {
        text: 'Run Waggle',
        thinkingLevel: 'medium',
        attachments: withAttachment
          ? [
              {
                id: 'attachment-1',
                kind: 'text',
                name: 'patch.txt',
                path: '/tmp/patch.txt',
                mimeType: 'text/plain',
                sizeBytes: 5,
                extractedText: 'patch',
              },
            ]
          : [],
      },
      model: SupportedModelId('openai/gpt-5.4'),
      config: {
        mode: 'sequential',
        agents: [
          { label: 'A', model: 'openai/gpt-5.4', roleDescription: 'A', color: 'blue' },
          { label: 'B', model: 'openai/gpt-5.4', roleDescription: 'B', color: 'amber' },
        ],
        stop: { primary: 'consensus', maxTurnsSafety: 4 },
      },
    },
  }
  return executeExplicitWaggleCommand({
    caller: { callerId: 'gui:local-user' },
    payload,
    ...(hostRunCeiling ? { hostRunCeiling } : {}),
  }).pipe(
    Effect.provideService(SessionControlAttachmentService, attachmentService),
    Effect.provideService(ExplicitWaggleOperationJournal, operationJournal),
  )
}

function runWaggleCommand(withAttachment = false, hostRunCeiling?: number, operationSuffix = '1') {
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(
      waggleCommand(withAttachment, hostRunCeiling, operationSuffix),
    ),
  )
}

describe('explicit Waggle command lifecycle', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    acquireLeaseMock.mockReset().mockReturnValue(Effect.succeed({ release: vi.fn() }))
    activateMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 3, intent: {} }))
    attachmentCleanupMock.mockReset().mockReturnValue(Effect.void)
    attachmentResolveMock.mockReset().mockReturnValue(Effect.succeed([]))
    executeWaggleRunMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ outcome: 'success', newMessages: [] }))
    emitWorktreeLaunchProgressMock.mockReset()
    forkSupervisedMock.mockReset().mockReturnValue(Effect.void)
    journalClaimMock.mockReset().mockReturnValue(Effect.succeed({ status: 'claimed' }))
    journalCompleteMock.mockReset().mockReturnValue(Effect.void)
    prepareMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 2, intent: {} }))
    requestHostDrainMock.mockReset()
    settleMock.mockReset().mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 4 }))
  })

  it('settles and releases a replacement cancelled during preparation', async () => {
    const preparation = Promise.withResolvers<{
      accepted: true
      stateRevision: number
      intent: Record<string, never>
    }>()
    const releaseLease = vi.fn()
    acquireLeaseMock.mockReturnValue(Effect.succeed({ release: releaseLease }))
    prepareMock.mockReturnValue(Effect.promise(() => preparation.promise))
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(prepareMock).toHaveBeenCalledOnce())

    cancelLocalExplicitWaggle(SESSION_ID)
    preparation.resolve({ accepted: true, stateRevision: 2, intent: {} })
    await expect(running).rejects.toThrow()

    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(settleMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminalStatus: 'interrupted' }),
    )
    expect(releaseLease).toHaveBeenCalledOnce()
  })

  it('waits for an interrupted classic writer before running explicit Waggle', async () => {
    const classic = reserveActiveSessionRun(SESSION_ID, 'classic-run')
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(classic.controller.signal.aborted).toBe(true))
    expect(executeWaggleRunMock).not.toHaveBeenCalled()

    classic.release()
    await expect(running).resolves.toMatchObject({ contract: 'session-waggle-v1' })
    expect(executeWaggleRunMock).toHaveBeenCalledOnce()
  })

  it('replays a completed command without allocating or replacing another Run', async () => {
    journalClaimMock.mockReturnValue(
      Effect.succeed({
        status: 'completed',
        replayed: true,
        report: { outcome: 'delivered' },
      }),
    )

    await expect(runWaggleCommand()).resolves.toMatchObject({
      response: { replayed: true, report: { outcome: 'delivered' } },
    })

    expect(attachmentResolveMock).not.toHaveBeenCalled()
    expect(prepareMock).not.toHaveBeenCalled()
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(journalCompleteMock).not.toHaveBeenCalled()
  })

  it('observes cancellation while the durable idempotency claim is pending', async () => {
    const durableClaim = Promise.withResolvers<{ readonly status: 'claimed' }>()
    journalClaimMock.mockReturnValue(Effect.promise(() => durableClaim.promise))
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(journalClaimMock).toHaveBeenCalledOnce())

    expect(cancelLocalExplicitWaggle(SESSION_ID)).toBe(true)
    durableClaim.resolve({ status: 'claimed' })
    await expect(running).rejects.toThrow('cancelled')

    expect(attachmentResolveMock).not.toHaveBeenCalled()
    expect(prepareMock).not.toHaveBeenCalled()
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(journalCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ report: { outcome: 'cancelled' } }),
    )
    expect(cancelLocalExplicitWaggle(SESSION_ID)).toBe(false)
  })

  it('holds pending ownership through cancelled cleanup before admitting a successor', async () => {
    const firstResolution = Promise.withResolvers<readonly []>()
    const firstCleanup = Promise.withResolvers<void>()
    attachmentResolveMock
      .mockReturnValueOnce(Effect.promise(() => firstResolution.promise))
      .mockReturnValue(Effect.succeed([]))
    attachmentCleanupMock
      .mockReturnValueOnce(Effect.promise(() => firstCleanup.promise))
      .mockReturnValue(Effect.void)
    const first = runWaggleCommand(false, undefined, 'cancelled')
    await vi.waitFor(() => expect(attachmentResolveMock).toHaveBeenCalledOnce())

    expect(cancelLocalExplicitWaggle(SESSION_ID)).toBe(true)
    firstResolution.resolve([])
    await vi.waitFor(() => expect(attachmentCleanupMock).toHaveBeenCalledOnce())

    const successor = runWaggleCommand(false, undefined, 'successor')
    await vi.waitFor(() => expect(journalClaimMock).toHaveBeenCalledTimes(2))
    expect(attachmentResolveMock).toHaveBeenCalledOnce()
    expect(prepareMock).not.toHaveBeenCalled()
    expect(
      journalCompleteMock.mock.calls.some(
        ([completion]) => completion.request.idempotencyKey === 'idempotency-successor',
      ),
    ).toBe(false)

    firstCleanup.resolve()
    await expect(first).rejects.toThrow('cancelled')
    await expect(successor).resolves.toMatchObject({
      response: { idempotencyKey: 'idempotency-successor', report: { outcome: 'delivered' } },
    })

    expect(prepareMock).toHaveBeenCalledOnce()
    expect(journalCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ idempotencyKey: 'idempotency-successor' }),
        report: { outcome: 'delivered' },
      }),
    )
  })

  it('orders cancelled cleanup after a successor attachment transition is durable', async () => {
    const firstRun = Promise.withResolvers<{ readonly outcome: 'aborted' }>()
    const successorResolution = Promise.withResolvers<readonly []>()
    executeWaggleRunMock
      .mockReturnValueOnce(Effect.promise(() => firstRun.promise))
      .mockReturnValue(Effect.succeed({ outcome: 'success', newMessages: [] }))
    attachmentResolveMock
      .mockReturnValueOnce(Effect.succeed([]))
      .mockReturnValueOnce(Effect.promise(() => successorResolution.promise))

    const first = runWaggleCommand(false, undefined, 'active')
    await vi.waitFor(() => expect(executeWaggleRunMock).toHaveBeenCalledOnce())
    expect(cancelLocalExplicitWaggle(SESSION_ID)).toBe(true)

    const successor = runWaggleCommand(false, undefined, 'successor')
    await vi.waitFor(() => expect(attachmentResolveMock).toHaveBeenCalledTimes(2))
    firstRun.resolve({ outcome: 'aborted' })
    await vi.waitFor(() => expect(activeWaggleRuns.has(SESSION_ID)).toBe(false))
    expect(attachmentCleanupMock).not.toHaveBeenCalled()

    successorResolution.resolve([])
    await expect(first).resolves.toMatchObject({
      response: { idempotencyKey: 'idempotency-active', report: { outcome: 'cancelled' } },
    })
    await expect(successor).resolves.toMatchObject({
      response: { idempotencyKey: 'idempotency-successor', report: { outcome: 'delivered' } },
    })

    expect(prepareMock).toHaveBeenCalledTimes(2)
    expect(attachmentCleanupMock).toHaveBeenCalledTimes(2)
    expect(attachmentCleanupMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      prepareMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    )
  })
})
