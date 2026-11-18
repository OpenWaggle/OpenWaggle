import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn(() => '/mock/path') },
}))

import { ipcRenderer } from 'electron'
import { api } from '../api'

describe('preload Session resource route selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps image catalog and location reads on the displayed Session path', async () => {
    const sessionId = SessionId('session-1')
    const selection = {
      branchId: 'session-1:branch:hidden',
      pathNodeIds: ['root-node', 'hidden-leaf'],
    }

    await api.listSessionResourcePage(sessionId, {
      view: 'images',
      limit: 40,
      selection,
    })
    await api.locateSessionResourceImage(sessionId, 'hidden-image', selection)

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'sessions:resources:page', sessionId, {
      view: 'images',
      limit: 40,
      selection,
    })
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      'sessions:resources:locate-image',
      sessionId,
      'hidden-image',
      selection,
    )
  })
})
