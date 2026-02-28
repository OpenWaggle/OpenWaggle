import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
}))

import { BrowserWindow } from 'electron'
import { broadcastToWindows } from './broadcast'

function createMockWindow(destroyed: boolean) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  }
}

describe('broadcastToWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends to all non-destroyed windows', () => {
    const win1 = createMockWindow(false)
    const win2 = createMockWindow(false)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      win1,
      win2,
    ] as unknown as Electron.BrowserWindow[])

    broadcastToWindows('test:channel', { data: 'hello' })

    expect(win1.webContents.send).toHaveBeenCalledWith('test:channel', { data: 'hello' })
    expect(win2.webContents.send).toHaveBeenCalledWith('test:channel', { data: 'hello' })
  })

  it('skips destroyed windows', () => {
    const alive = createMockWindow(false)
    const destroyed = createMockWindow(true)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      alive,
      destroyed,
    ] as unknown as Electron.BrowserWindow[])

    broadcastToWindows('test:channel', 'payload')

    expect(alive.webContents.send).toHaveBeenCalledOnce()
    expect(alive.webContents.send).toHaveBeenCalledWith('test:channel', 'payload')
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('handles empty window list gracefully', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

    // Should not throw
    broadcastToWindows('test:channel', 'data')
  })

  it('passes multiple args to webContents.send', () => {
    const win = createMockWindow(false)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      win,
    ] as unknown as Electron.BrowserWindow[])

    broadcastToWindows('multi:args', 'arg1', 42, { nested: true })

    expect(win.webContents.send).toHaveBeenCalledWith('multi:args', 'arg1', 42, { nested: true })
  })
})
