import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSessionResourceHandlerMocks,
  invokeSessionResourceHandler as invoke,
  resetSessionResourceHandlerHarness,
} from './session-resource-handler.test-harness'

const handlerMocks = getSessionResourceHandlerMocks()

describe('session resource route-selection IPC', () => {
  beforeEach(() => {
    resetSessionResourceHandlerHarness()
  })

  it('forwards the bounded displayed transcript path to catalog and image lookups', async () => {
    const sessionId = SessionId('session-one')
    const selection = {
      branchId: 'session-one:branch:hidden',
      pathNodeIds: ['root-node', 'hidden-leaf'],
    }
    handlerMocks.listPage.mockReturnValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'hidden',
    })

    await invoke('sessions:resources:page', sessionId, {
      view: 'images',
      limit: 40,
      selection,
    })
    await invoke('sessions:resources:locate-image', sessionId, 'hidden-image', selection)

    expect(handlerMocks.listPage).toHaveBeenCalledWith(sessionId, {
      view: 'images',
      limit: 40,
      selection,
    })
    expect(handlerMocks.locateImage).toHaveBeenCalledWith(sessionId, 'hidden-image', selection)
  })

  it('rejects an oversized or malformed displayed transcript path', async () => {
    const sessionId = SessionId('session-one')
    await expect(
      invoke('sessions:resources:page', sessionId, {
        view: 'images',
        limit: 40,
        selection: {
          branchId: 'session-one:branch:hidden',
          pathNodeIds: Array.from({ length: 513 }, (_, index) => `node-${String(index)}`),
        },
      }),
    ).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:locate-image', sessionId, 'hidden-image', {
        branchId: '../other-session',
        pathNodeIds: ['hidden-leaf'],
      }),
    ).rejects.toBeDefined()

    expect(handlerMocks.listPage).not.toHaveBeenCalled()
    expect(handlerMocks.locateImage).not.toHaveBeenCalled()
  })

  it("accepts a discovered Pi session's prefixed node ids, and nothing past the prefix", async () => {
    const sessionId = SessionId('session-one')
    handlerMocks.listPage.mockReturnValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'prefixed',
    })
    await invoke('sessions:resources:page', sessionId, {
      view: 'all',
      limit: 40,
      selection: { branchId: 'main', pathNodeIds: ['session-one/a1b2c3d4'] },
    })
    expect(handlerMocks.listPage).toHaveBeenCalledTimes(1)

    await expect(
      invoke('sessions:resources:page', sessionId, {
        view: 'all',
        limit: 40,
        selection: { branchId: 'main', pathNodeIds: ['session-one/../other/a1b2c3d4'] },
      }),
    ).rejects.toBeDefined()
    expect(handlerMocks.listPage).toHaveBeenCalledTimes(1)
  })
})
