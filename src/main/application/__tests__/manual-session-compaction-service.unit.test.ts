import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelCompactionSessionRunMock,
  compactAgentSessionMock,
  hasAnyActiveRunMock,
  publishSessionHostEventMock,
  releaseWriterMock,
  reserveCompactionSessionWriterMock,
} = vi.hoisted(() => ({
  cancelCompactionSessionRunMock: vi.fn(),
  compactAgentSessionMock: vi.fn(),
  hasAnyActiveRunMock: vi.fn(() => false),
  publishSessionHostEventMock: vi.fn(),
  releaseWriterMock: vi.fn(),
  reserveCompactionSessionWriterMock: vi.fn(),
}))

vi.mock('../active-session-runs', () => ({
  cancelCompactionSessionRun: cancelCompactionSessionRunMock,
  hasAnyActiveRun: hasAnyActiveRunMock,
  reserveCompactionSessionWriter: reserveCompactionSessionWriterMock,
}))

vi.mock('../agent-session-service', () => ({ compactAgentSession: compactAgentSessionMock }))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

import {
  executeManualSessionCompaction,
  executeManualSessionCompactionCancellation,
} from '../manual-session-compaction-service'

const SESSION_ID = SessionId('session-compact')
const MODEL = SupportedModelId('openai/gpt-5.5')

function compactionCommand(callerId = 'gui:local-user') {
  return executeManualSessionCompaction({
    caller: { callerId },
    payload: {
      contract: 'local-compaction-v1',
      request: {
        requestId: 'compact-request',
        sessionId: SESSION_ID,
        model: MODEL,
        customInstructions: 'Keep the current implementation decision.',
      },
    },
  })
}

function runCompactionCommand(callerId?: string) {
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(compactionCommand(callerId)),
  )
}

describe('manual Session compaction service', () => {
  beforeEach(() => {
    cancelCompactionSessionRunMock.mockReset().mockReturnValue(false)
    compactAgentSessionMock.mockReset()
    hasAnyActiveRunMock.mockReset().mockReturnValue(false)
    publishSessionHostEventMock.mockReset()
    releaseWriterMock.mockReset()
    reserveCompactionSessionWriterMock
      .mockReset()
      .mockReturnValue({ controller: new AbortController(), release: releaseWriterMock })
  })

  it('runs on the owner and publishes the successful end only after persistence completes', async () => {
    const order: string[] = []
    compactAgentSessionMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onEvent({ type: 'compaction_start', reason: 'manual' })
        input.onEvent({ type: 'compaction_end', reason: 'manual', aborted: false })
        order.push('persisted')
        return { summary: 'summary', firstKeptEntryId: 'kept-entry', tokensBefore: 500 }
      }),
    )
    publishSessionHostEventMock.mockImplementation((event) => order.push(event.event.type))

    await expect(runCompactionCommand()).resolves.toMatchObject({
      contract: 'local-compaction-v1',
      response: { requestId: 'compact-request', result: { summary: 'summary' } },
    })

    expect(order).toEqual(['compaction_start', 'persisted', 'compaction_end'])
    expect(reserveCompactionSessionWriterMock).toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(AbortController),
      MODEL,
    )
    expect(releaseWriterMock).toHaveBeenCalledOnce()
  })

  it('rejects non-GUI callers before touching Pi state', async () => {
    await expect(runCompactionCommand('cli:external')).rejects.toThrow(
      'authenticated local GUI caller',
    )
    expect(reserveCompactionSessionWriterMock).not.toHaveBeenCalled()
    expect(compactAgentSessionMock).not.toHaveBeenCalled()
  })

  it('cancels only the owner-side compaction registry for an authenticated GUI caller', async () => {
    cancelCompactionSessionRunMock.mockReturnValue(true)

    await expect(
      Effect.runPromise(
        executeManualSessionCompactionCancellation({
          caller: { callerId: 'gui:local-user' },
          payload: {
            contract: 'local-compaction-cancel-v1',
            request: { requestId: 'cancel-request', sessionId: SESSION_ID },
          },
        }),
      ),
    ).resolves.toEqual({
      contract: 'local-compaction-cancel-v1',
      response: { requestId: 'cancel-request', sessionId: SESSION_ID, cancelled: true },
    })
    expect(cancelCompactionSessionRunMock).toHaveBeenCalledWith(SESSION_ID)
  })
})
