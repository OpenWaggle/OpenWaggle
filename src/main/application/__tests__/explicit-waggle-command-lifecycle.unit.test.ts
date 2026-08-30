import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireLeaseMock,
  activateMock,
  attachmentBindMock,
  attachmentCleanupMock,
  executeWaggleRunMock,
  emitWorktreeLaunchProgressMock,
  forkSupervisedMock,
  prepareMock,
  requestHostDrainMock,
  settleMock,
} = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  activateMock: vi.fn(),
  attachmentBindMock: vi.fn(),
  attachmentCleanupMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
  emitWorktreeLaunchProgressMock: vi.fn(),
  forkSupervisedMock: vi.fn(),
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

const SESSION_ID = SessionId('session-lifecycle')
const attachmentService = SessionControlAttachmentService.of({
  prepare: () => Effect.die('unused'),
  bind: attachmentBindMock,
  cleanupUnreferenced: attachmentCleanupMock,
  resolve: () => Effect.die('unused'),
  release: () => Effect.die('unused'),
})

function waggleCommand(withAttachment = false) {
  const payload: Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }> = {
    contract: 'session-waggle-v1',
    request: {
      contractVersion: 1,
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
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
  return executeExplicitWaggleCommand({ caller: { callerId: 'gui:local-user' }, payload }).pipe(
    Effect.provideService(SessionControlAttachmentService, attachmentService),
  )
}

function runWaggleCommand(withAttachment = false) {
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(waggleCommand(withAttachment)),
  )
}

describe('explicit Waggle command lifecycle', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    acquireLeaseMock.mockReset().mockReturnValue(Effect.succeed({ release: vi.fn() }))
    activateMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 3, intent: {} }))
    attachmentBindMock.mockReset().mockReturnValue(Effect.void)
    attachmentCleanupMock.mockReset().mockReturnValue(Effect.void)
    executeWaggleRunMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ outcome: 'success', newMessages: [] }))
    emitWorktreeLaunchProgressMock.mockReset()
    forkSupervisedMock.mockReset().mockReturnValue(Effect.void)
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
    await runWaggleCommand(true)

    expect(attachmentBindMock).toHaveBeenCalledWith({
      attachmentIds: ['attachment-1'],
      sessionId: SESSION_ID,
      ownerCallerId: 'gui:local-user',
    })
    expect(attachmentCleanupMock).toHaveBeenCalledWith({ sessionId: SESSION_ID })
  })

  it('drains the Host and releases ownership after an execution defect', async () => {
    const releaseLease = vi.fn()
    acquireLeaseMock.mockReturnValue(Effect.succeed({ release: releaseLease }))
    activateMock.mockReturnValue(Effect.die(new Error('repository defect')))

    await expect(runWaggleCommand()).rejects.toThrow()

    expect(requestHostDrainMock).toHaveBeenCalledOnce()
    expect(releaseLease).toHaveBeenCalledOnce()
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    expect(pendingWaggleRuns.has(SESSION_ID)).toBe(false)
  })

  it('drains the Host and releases its lease after a preparation defect', async () => {
    const releaseLease = vi.fn()
    acquireLeaseMock.mockReturnValue(Effect.succeed({ release: releaseLease }))
    prepareMock.mockReturnValue(Effect.die(new Error('ambiguous preparation defect')))

    await expect(runWaggleCommand()).rejects.toThrow()

    expect(requestHostDrainMock).toHaveBeenCalledOnce()
    expect(releaseLease).toHaveBeenCalledOnce()
    expect(pendingWaggleRuns.has(SESSION_ID)).toBe(false)
  })
})
