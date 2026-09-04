import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridgeMocks = vi.hoisted(() => ({ broadcast: vi.fn() }))

vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: bridgeMocks.broadcast }))

import { publishSessionResourceInvalidation } from '../../application/session-resource-invalidation'
import {
  disposeSessionResourceInvalidationBridge,
  registerSessionResourceInvalidationBridge,
} from '../session-resource-invalidation-bridge'

describe('session resource invalidation bridge', () => {
  beforeEach(() => {
    bridgeMocks.broadcast.mockReset()
    disposeSessionResourceInvalidationBridge()
  })

  afterEach(() => {
    disposeSessionResourceInvalidationBridge()
  })

  it('forwards only the owning Session id to renderer windows', () => {
    registerSessionResourceInvalidationBridge()

    publishSessionResourceInvalidation(SessionId('session-one'))

    expect(bridgeMocks.broadcast).toHaveBeenCalledOnce()
    expect(bridgeMocks.broadcast).toHaveBeenCalledWith('sessions:resources-invalidated', {
      sessionId: SessionId('session-one'),
    })
  })

  it('replaces a prior registration instead of leaking duplicate listeners', () => {
    registerSessionResourceInvalidationBridge()
    registerSessionResourceInvalidationBridge()

    publishSessionResourceInvalidation(SessionId('session-one'))

    expect(bridgeMocks.broadcast).toHaveBeenCalledOnce()
  })
})
