import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeWaggleRunMock, journalCompleteMock, prepareMock, releaseLeaseMock } = vi.hoisted(
  () => ({
    executeWaggleRunMock: vi.fn(),
    journalCompleteMock: vi.fn(),
    prepareMock: vi.fn(),
    releaseLeaseMock: vi.fn(),
  }),
)

vi.mock('../session-host-run-admission', () => ({
  acquireSessionHostRunLease: () => Effect.succeed({ release: releaseLeaseMock }),
}))
vi.mock('../session-external-run-coordinator', () => ({
  activatePreparedExternalSessionRun: vi.fn(),
  prepareExternalSessionRunReplacement: prepareMock,
  settleExternalSessionRun: vi.fn(),
}))
vi.mock('../waggle-run-service', () => ({ executeWaggleRun: executeWaggleRunMock }))
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: vi.fn(),
  tryGetSessionHostEventRuntime: vi.fn(() => ({ liveness: { requestDrain: vi.fn() } })),
}))

import { ExplicitWaggleOperationJournal } from '../../ports/explicit-waggle-operation-journal'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { cancelAllSessionRuns } from '../active-session-runs'
import { executeExplicitWaggleCommand } from '../explicit-waggle-command-service'

const SESSION_ID = SessionId('session-refused-waggle')

function runWaggleCommand() {
  const payload: Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }> = {
    contract: 'session-waggle-v1',
    request: {
      contractVersion: 1,
      requestId: 'request-refused',
      idempotencyKey: 'idempotency-refused',
      sessionId: SESSION_ID,
      payload: { text: 'Run Waggle', attachments: [] },
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
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(
      executeExplicitWaggleCommand({ caller: { callerId: 'gui:local-user' }, payload }).pipe(
        Effect.provideService(
          SessionControlAttachmentService,
          SessionControlAttachmentService.of({
            prepare: () => Effect.die('unused'),
            bind: () => Effect.die('unused'),
            cleanupUnreferenced: () => Effect.void,
            resolve: () => Effect.succeed([]),
            release: () => Effect.die('unused'),
          }),
        ),
        Effect.provideService(
          ExplicitWaggleOperationJournal,
          ExplicitWaggleOperationJournal.of({
            claim: () => Effect.succeed({ status: 'claimed' }),
            complete: journalCompleteMock,
          }),
        ),
        Effect.provideService(
          SessionProjectionRepository,
          SessionProjectionRepository.of(fromPartial({ getOptional: () => Effect.succeed(null) })),
        ),
      ),
    ),
  )
}

describe('explicit Waggle refused by the Session', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    executeWaggleRunMock.mockReset()
    journalCompleteMock.mockReset().mockReturnValue(Effect.void)
    prepareMock.mockReset()
    releaseLeaseMock.mockReset()
  })

  it('reports a refusal while a steered message is delivered, not an unconfirmed outcome', async () => {
    // The Host refuses to replace a Run that a queued message is being steered into. That is an
    // expected, retryable refusal: the user is told why, and the journal records it as refused.
    prepareMock.mockReturnValue(Effect.succeed({ accepted: false, code: 'follow_up_reserved' }))
    const refused = {
      outcome: 'refused',
      code: 'follow_up_reserved',
      message: expect.stringContaining('steered message is still being delivered'),
    }

    await expect(runWaggleCommand()).resolves.toMatchObject({ response: { report: refused } })

    expect(journalCompleteMock).toHaveBeenCalledOnce()
    expect(journalCompleteMock).toHaveBeenCalledWith(expect.objectContaining({ report: refused }))
    expect(executeWaggleRunMock).not.toHaveBeenCalled()
    expect(releaseLeaseMock).toHaveBeenCalledOnce()
  })
})
