import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchLocalSessionCommandMock,
  getInvokeHandler,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
  setAuthorizationModeMock,
} from './session-details-handler.test-harness'

describe('Session detail authorization handlers', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
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
            effectiveAuthorizationMode: 'ask-for-approval',
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

  it('clears the override with null so the session inherits again', async () => {
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
            authorizationMode: null,
            effectiveAuthorizationMode: 'ask-for-approval',
          },
        },
      }),
    )
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:set-authorization-mode')

    await handler?.({}, SessionId('session-authorization'), null)

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({ authorizationMode: null }),
          }),
        }),
      }),
    )
  })

  it('rejects invalid session authorization modes', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:set-authorization-mode')

    await expect(handler?.({}, SessionId('session-authorization'), 'always-allow')).rejects.toThrow(
      'Session authorization mode is invalid.',
    )
    expect(setAuthorizationModeMock).not.toHaveBeenCalled()
  })
})
