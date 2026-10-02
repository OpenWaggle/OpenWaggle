import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureSessionScratchNamespace,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'

const {
  acquireLeaseMock,
  activateMock,
  attachmentCleanupMock,
  attachmentResolveMock,
  captureResourcesMock,
  executeWaggleRunMock,
  forkSupervisedMock,
  journalClaimMock,
  journalCompleteMock,
  prepareMock,
  requestHostDrainMock,
  settleMock,
  sessionDetailMock,
} = vi.hoisted(() => ({
  sessionDetailMock: vi.fn(),
  acquireLeaseMock: vi.fn(),
  activateMock: vi.fn(),
  attachmentCleanupMock: vi.fn(),
  attachmentResolveMock: vi.fn(),
  captureResourcesMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
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
vi.mock('../session-resource-run-result', () => ({
  captureRunResultResources: captureResourcesMock,
}))
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

import { ExplicitWaggleOperationJournal } from '../../ports/explicit-waggle-operation-journal'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { cancelAllSessionRuns } from '../active-session-runs'
import { executeExplicitWaggleCommand } from '../explicit-waggle-command-service'

const SESSION_ID = SessionId('session-lifecycle')
const attachmentService = SessionControlAttachmentService.of({
  prepare: () => Effect.die('unused'),
  bind: () => Effect.die('unused'),
  cleanupUnreferenced: attachmentCleanupMock,
  resolve: attachmentResolveMock,
  release: () => Effect.die('unused'),
})
const sessionProjection = SessionProjectionRepository.of(
  fromPartial({ getOptional: (id: SessionId) => sessionDetailMock(id) }),
)
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
    Effect.provideService(SessionProjectionRepository, sessionProjection),
  )
}

function runWaggleCommand(withAttachment = false, hostRunCeiling?: number, operationSuffix = '1') {
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(
      waggleCommand(withAttachment, hostRunCeiling, operationSuffix),
    ),
  )
}

const namespaceRestores: (() => void)[] = []
const CAPTURE_WORK_MS = 100

describe('explicit Waggle resource capture', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    acquireLeaseMock.mockReset().mockReturnValue(Effect.succeed({ release: vi.fn() }))
    activateMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 3, intent: {} }))
    attachmentCleanupMock.mockReset().mockReturnValue(Effect.void)
    attachmentResolveMock.mockReset().mockReturnValue(Effect.succeed([]))
    captureResourcesMock.mockReset().mockReturnValue(Effect.void)
    executeWaggleRunMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ outcome: 'success', newMessages: [] }))
    forkSupervisedMock.mockReset().mockReturnValue(Effect.void)
    journalClaimMock.mockReset().mockReturnValue(Effect.succeed({ status: 'claimed' }))
    journalCompleteMock.mockReset().mockReturnValue(Effect.void)
    prepareMock
      .mockReset()
      .mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 2, intent: {} }))
    requestHostDrainMock.mockReset()
    sessionDetailMock.mockReset().mockReturnValue(Effect.succeed(null))
    settleMock.mockReset().mockReturnValue(Effect.succeed({ accepted: true, stateRevision: 4 }))
  })

  afterEach(async () => {
    await fs.rm(sessionScratchRoot(), { recursive: true, force: true })
    for (const restore of namespaceRestores.splice(0)) restore()
  })

  it("captures the Waggle's resources, like a classic Run", async () => {
    const result = { outcome: 'success', newMessages: [], resourceMessages: [] }
    executeWaggleRunMock.mockReturnValue(Effect.succeed(result))

    await expect(runWaggleCommand()).resolves.toMatchObject({ contract: 'session-waggle-v1' })

    expect(captureResourcesMock).toHaveBeenCalledOnce()
    expect(captureResourcesMock).toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(String),
      expect.objectContaining({ text: 'Run Waggle' }),
      result,
    )
  })

  it('captures an image from the scratch directory when the Session is archived mid-Waggle', async () => {
    namespaceRestores.push(configureSessionScratchNamespace(`waggle-capture-${randomUUID()}`))
    const directory = await prepareSessionScratchDirectory(SESSION_ID)
    const image = path.join(directory, 'evidence.png')
    executeWaggleRunMock.mockReturnValue(
      Effect.promise(async () => {
        await fs.writeFile(image, 'png')
        // The user archives the Session while the last agent's turn is still running.
        await removeSessionScratchDirectory(SESSION_ID)
        return { outcome: 'success', newMessages: [], resourceMessages: [] }
      }),
    )
    let imageAtCapture: string | undefined
    captureResourcesMock.mockImplementation(() =>
      Effect.promise(async () => {
        // The real capture writes to the database before it reads files; give a removal that
        // was not deferred time to finish first.
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_WORK_MS))
        imageAtCapture = await fs.readFile(image, 'utf8').catch(() => undefined)
      }),
    )

    await runWaggleCommand()

    expect(imageAtCapture).toBe('png')
    await vi.waitFor(async () => {
      await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
