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

vi.mock('../session-host-run-admission', () => ({ acquireSessionHostRunLease: acquireLeaseMock }))
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
  interruptExactSessionRun,
  pendingWaggleRuns,
  reserveActiveSessionRun,
  reserveWaggleSessionWriter,
} from '../active-session-runs'
import {
  cancelLocalExplicitWaggle,
  executeExplicitWaggleCommand,
} from '../explicit-waggle-command-service'

const SESSION_ID = SessionId('session-lifecycle-races')
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

function runWaggleCommand(withAttachment = false, hostRunCeiling?: number) {
  const payload: Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }> = {
    contract: 'session-waggle-v1',
    request: {
      contractVersion: 1,
      requestId: 'request-races',
      idempotencyKey: 'idempotency-races',
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
  const effect = executeExplicitWaggleCommand({
    caller: { callerId: 'gui:local-user' },
    payload,
    ...(hostRunCeiling ? { hostRunCeiling } : {}),
  }).pipe(
    Effect.provideService(SessionControlAttachmentService, attachmentService),
    Effect.provideService(ExplicitWaggleOperationJournal, operationJournal),
  )
  return Effect.runPromise(fromAny<Effect.Effect<unknown, Error, never>, unknown>(effect))
}

describe('explicit Waggle command cleanup and admission races', () => {
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

  it('passes the configured Host Run ceiling into idle replacement admission', async () => {
    await runWaggleCommand(false, 7)
    expect(prepareMock).toHaveBeenCalledWith(expect.objectContaining({ hostRunCeiling: 7 }))
  })

  it('does not let a cancelled attachment preflight replace its successor Run', async () => {
    const resolution = Promise.withResolvers<readonly []>()
    attachmentResolveMock.mockReturnValue(Effect.promise(() => resolution.promise))
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(attachmentResolveMock).toHaveBeenCalledOnce())

    cancelLocalExplicitWaggle(SESSION_ID)
    const successor = reserveActiveSessionRun(SESSION_ID, 'successor-run')
    resolution.resolve([])
    await expect(running).rejects.toThrow('cancelled')

    expect(successor.controller.signal.aborted).toBe(false)
    expect(prepareMock).not.toHaveBeenCalled()
    expect(journalCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ report: { outcome: 'cancelled' } }),
    )
    successor.release()
  })

  it('publishes worktree launch progress from explicit Waggle execution', async () => {
    const progress = { stage: 'checking-out-files' as const, details: ['Checking out files'] }
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onWorktreeLaunch?.(progress)
        return { outcome: 'success', newMessages: [] }
      }),
    )
    await runWaggleCommand()
    expect(emitWorktreeLaunchProgressMock).toHaveBeenCalledWith(SESSION_ID, progress)
  })

  it('interrupts a pending replacement and supervises its queued Follow-up', async () => {
    forkSupervisedMock.mockReturnValue(Effect.fail(new Error('supervision failed')))
    settleMock.mockReturnValue(
      Effect.succeed({
        accepted: true,
        stateRevision: 4,
        scheduled: { followUpId: 'follow-up-1', runId: 'follow-up-run', intent: {} },
      }),
    )
    const classic = reserveActiveSessionRun(SESSION_ID, 'classic-run')
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(classic.controller.signal.aborted).toBe(true))
    const pendingRunId = pendingWaggleRuns.get(SESSION_ID)?.metadata.runId

    const interruption = interruptExactSessionRun(SESSION_ID, pendingRunId ?? '')
    classic.release()
    await expect(interruption).resolves.toBe(true)
    await expect(running).rejects.toThrow()
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(forkSupervisedMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, runId: 'follow-up-run' }),
    )
  })

  it('cancels both an active Waggle writer and its pending replacement', async () => {
    const oldController = new AbortController()
    const oldWriter = reserveWaggleSessionWriter(SESSION_ID, oldController, 'waggle-old')
    const running = runWaggleCommand()
    await vi.waitFor(() => expect(oldController.signal.aborted).toBe(true))

    cancelLocalExplicitWaggle(SESSION_ID)
    oldWriter.release()
    await expect(running).rejects.toThrow()
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(pendingWaggleRuns.has(SESSION_ID)).toBe(false)
  })

  it('binds and cleans prepared attachments around explicit Waggle execution', async () => {
    const hydratedAttachment = {
      id: 'attachment-1',
      kind: 'text' as const,
      name: 'patch.txt',
      path: '/tmp/patch.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      extractedText: 'patch',
      source: null,
    }
    attachmentResolveMock.mockReturnValue(Effect.succeed([hydratedAttachment]))
    await runWaggleCommand(true)

    expect(attachmentResolveMock).toHaveBeenCalledWith({
      attachmentIds: ['attachment-1'],
      sessionId: SESSION_ID,
      ownerCallerId: 'gui:local-user',
    })
    expect(executeWaggleRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ hydratedAttachments: [hydratedAttachment] }),
    )
    expect(attachmentCleanupMock).toHaveBeenCalledWith({ sessionId: SESSION_ID })
  })

  it.each([
    ['execution', () => activateMock.mockReturnValue(Effect.die(new Error('repository defect')))],
    [
      'preparation',
      () => prepareMock.mockReturnValue(Effect.die(new Error('ambiguous preparation defect'))),
    ],
  ])('drains the Host and releases ownership after an %s defect', async (_kind, fail) => {
    const releaseLease = vi.fn()
    acquireLeaseMock.mockReturnValue(Effect.succeed({ release: releaseLease }))
    fail()

    await expect(runWaggleCommand()).rejects.toThrow()
    expect(requestHostDrainMock).toHaveBeenCalledOnce()
    expect(releaseLease).toHaveBeenCalledOnce()
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(pendingWaggleRuns.has(SESSION_ID)).toBe(false)
  })
})
