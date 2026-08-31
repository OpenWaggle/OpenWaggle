import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionControlRepositoryError } from '../../errors'
import type { SessionReportRepositoryShape } from '../../ports/session-report-repository'

const { acquireMock, publishMock, releaseMock, requestDrainMock } = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  publishMock: vi.fn(),
  releaseMock: vi.fn(),
  requestDrainMock: vi.fn(),
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishMock,
  tryGetSessionHostEventRuntime: () => ({
    liveness: { acquire: acquireMock, requestDrain: requestDrainMock },
  }),
}))

import { markReportsDelivered } from '../session-control-run-context-delivery'

function repositoryWithAcknowledgement(
  acknowledgement: SessionReportRepositoryShape['markDelivered'],
) {
  return {
    execute: () => Effect.dieMessage('not used'),
    listPending: () => Effect.succeed([]),
    markDelivered: acknowledgement,
  } satisfies SessionReportRepositoryShape
}

function acknowledgementFailure() {
  return new SessionControlRepositoryError({
    operation: 'mark-delivered',
    cause: new Error('database unavailable'),
  })
}

describe('Session control context-delivery supervision', () => {
  beforeEach(() => {
    acquireMock.mockReset()
    publishMock.mockReset()
    releaseMock.mockReset()
    requestDrainMock.mockReset()
    acquireMock.mockReturnValue(releaseMock)
  })

  it('retries a durable acknowledgement before publishing delivery', async () => {
    let attempts = 0
    const repository = repositoryWithAcknowledgement(() =>
      Effect.suspend(() => {
        attempts += 1
        return attempts < 3 ? Effect.fail(acknowledgementFailure()) : Effect.void
      }),
    )

    markReportsDelivered(repository, { sessionId: SessionId('session-a'), runId: RunId('run-a') }, [
      'report-a',
    ])

    await vi.waitFor(() => expect(releaseMock).toHaveBeenCalledOnce())
    expect(attempts).toBe(3)
    expect(publishMock).toHaveBeenCalledOnce()
    expect(requestDrainMock).not.toHaveBeenCalled()
  })

  it('drains the Host after a persistent acknowledgement failure', async () => {
    let attempts = 0
    const repository = repositoryWithAcknowledgement(() =>
      Effect.suspend(() => {
        attempts += 1
        return Effect.fail(acknowledgementFailure())
      }),
    )

    markReportsDelivered(repository, { sessionId: SessionId('session-a'), runId: RunId('run-a') }, [
      'report-a',
    ])

    await vi.waitFor(() => expect(requestDrainMock).toHaveBeenCalledOnce())
    expect(attempts).toBe(3)
    expect(publishMock).not.toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalledOnce()
  })
})
