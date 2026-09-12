import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupSessionRunMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  deleteVisualizationSessionMock,
  dispatchLocalSessionCommandMock,
  emitRunCompletedMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
  rollbackVisualizationSessionDeletionMock,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

describe('session detail lifecycle mutations', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('deletes through the Session Host before clearing GUI run state', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await handler?.({}, SessionId('session-delete'))

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: { operation: 'delete', sessionId: 'session-delete' },
          }),
        }),
      }),
    )
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(clearStreamBufferMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(emitRunCompletedMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
    expect(rollbackVisualizationSessionDeletionMock).not.toHaveBeenCalled()
  })

  it('archives a session through the Session Host', async () => {
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'session-control-v2',
        response: {
          contractVersion: 2,
          requestId: 'archive-request',
          idempotencyKey: 'archive-once',
          replayed: false,
          outcome: {
            operation: 'archive',
            effect: 'session-archived',
            sessionId: 'session-archive',
          },
        },
      }),
    )

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:archive')

    await handler?.({}, SessionId('session-archive'))

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: { operation: 'archive', sessionId: 'session-archive' },
          }),
        }),
      }),
    )
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
  })

  it('does not stage local visualization files when Session Host deletion fails', async () => {
    dispatchLocalSessionCommandMock.mockReturnValue(Effect.fail(new Error('host unavailable')))
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await expect(handler?.({}, SessionId('session-delete'))).rejects.toThrow()

    expect(rollbackVisualizationSessionDeletionMock).not.toHaveBeenCalled()
    expect(deleteVisualizationSessionMock).not.toHaveBeenCalled()
  })

  it('updates a session authorization mode through the Session Host', async () => {
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'session-control-v2',
        response: {
          contractVersion: 2,
          requestId: 'authorization-request',
          idempotencyKey: 'authorization-once',
          replayed: false,
          outcome: {
            operation: 'authorization-set',
            effect: 'authorization-updated',
            sessionId: 'session-authorization',
            authorizationMode: 'ask-for-approval',
          },
        },
      }),
    )
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:set-authorization-mode')

    await handler?.({}, SessionId('session-authorization'), 'ask-for-approval')

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: {
              operation: 'authorization-set',
              sessionId: 'session-authorization',
              authorizationMode: 'ask-for-approval',
            },
          }),
        }),
      }),
    )
  })
})
