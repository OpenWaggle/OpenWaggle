import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const windows = vi.hoisted(() => ({ all: vi.fn() }))
vi.mock('../../desktop-ui', () => ({ getAllBrowserWindows: windows.all }))

import type { DesktopWindow } from '../../ports/desktop-shell/desktop-windows'
import { broadcastToWindows } from '../broadcast'

function createMockWindow(destroyed: boolean) {
  return fromPartial<DesktopWindow>({
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  })
}

describe('broadcastToWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends to all non-destroyed windows', () => {
    const win1 = createMockWindow(false)
    const win2 = createMockWindow(false)
    windows.all.mockReturnValue([win1, win2])

    broadcastToWindows('test:channel', { data: 'hello' })

    expect(win1.webContents.send).toHaveBeenCalledWith('test:channel', { data: 'hello' })
    expect(win2.webContents.send).toHaveBeenCalledWith('test:channel', { data: 'hello' })
  })

  it('skips destroyed windows', () => {
    const alive = createMockWindow(false)
    const destroyed = createMockWindow(true)
    windows.all.mockReturnValue([alive, destroyed])

    broadcastToWindows('test:channel', 'payload')

    expect(alive.webContents.send).toHaveBeenCalledOnce()
    expect(alive.webContents.send).toHaveBeenCalledWith('test:channel', 'payload')
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('handles empty window list gracefully', () => {
    windows.all.mockReturnValue([])

    // Should not throw
    broadcastToWindows('test:channel', 'data')
  })

  it('passes multiple args to webContents.send', () => {
    const win = createMockWindow(false)
    windows.all.mockReturnValue([win])

    broadcastToWindows('multi:args', 'arg1', 42, { nested: true })

    expect(win.webContents.send).toHaveBeenCalledWith('multi:args', 'arg1', 42, { nested: true })
  })
})
