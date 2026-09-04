import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const integrationMocks = vi.hoisted(() => ({
  send: vi.fn(),
  isDestroyed: vi.fn(() => false),
  getAllBrowserWindows: vi.fn(),
}))

vi.mock('../../desktop-ui', () => ({
  getAllBrowserWindows: integrationMocks.getAllBrowserWindows,
}))

import { publishSessionResourceInvalidation } from '../../application/session-resource-invalidation'
import {
  disposeSessionResourceInvalidationBridge,
  registerSessionResourceInvalidationBridge,
} from '../session-resource-invalidation-bridge'

describe('session resource invalidation main-to-renderer integration', () => {
  beforeEach(() => {
    integrationMocks.send.mockReset()
    integrationMocks.isDestroyed.mockReset().mockReturnValue(false)
    integrationMocks.getAllBrowserWindows.mockReset().mockReturnValue([
      {
        isDestroyed: integrationMocks.isDestroyed,
        webContents: { send: integrationMocks.send },
      },
    ])
    disposeSessionResourceInvalidationBridge()
    registerSessionResourceInvalidationBridge()
  })

  afterEach(() => {
    disposeSessionResourceInvalidationBridge()
  })

  it('delivers the exact changed Session through the BrowserWindow transport', () => {
    publishSessionResourceInvalidation(SessionId('session-owner'))

    expect(integrationMocks.send).toHaveBeenCalledOnce()
    expect(integrationMocks.send).toHaveBeenCalledWith('sessions:resources-invalidated', {
      sessionId: SessionId('session-owner'),
    })
  })

  it('skips destroyed windows without affecting healthy windows', () => {
    integrationMocks.getAllBrowserWindows.mockReturnValue([
      {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      },
      {
        isDestroyed: integrationMocks.isDestroyed,
        webContents: { send: integrationMocks.send },
      },
    ])

    publishSessionResourceInvalidation(SessionId('session-owner'))

    expect(integrationMocks.send).toHaveBeenCalledOnce()
  })
})
