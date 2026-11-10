import { beforeEach, describe, expect, it } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()
const registry = getBrowserPreviewOwnerRegistryMock()
const floatingBounds = {
  x: 20,
  y: 20,
  width: 320,
  height: 200,
  sourceViewport: { width: 1280, height: 800 },
}

describe('browser preview native viewport lifecycle', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    registry.assertRegistered.mockReset()
    registry.notifyMaterialized.mockReset()
  })

  it('defers initial floating emulation until the native renderer has a DOM', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const view = firstView()
    expect(view.webContents.loadURL).toHaveBeenCalledOnce()
    expect(view.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
    view.webContents.emit('dom-ready')
    expect(view.webContents.enableDeviceEmulation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ viewSize: { width: 1280, height: 800 }, scale: 0.25 }),
    )
    manager.close(owner, 'preview-1')
  })

  it('uses the latest pending viewport, bounds and zoom when the page becomes ready', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    manager.setViewport(owner, 'preview-1', {
      mode: 'fixed',
      width: 1000,
      height: 600,
      presetId: null,
    })
    manager.setBounds(owner, 'preview-1', { x: 0, y: 0, width: 550, height: 330 })
    manager.zoom(owner, 'preview-1', 'in')
    expect(contents.enableDeviceEmulation).not.toHaveBeenCalled()
    contents.emit('dom-ready')
    expect(contents.enableDeviceEmulation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ viewSize: { width: 1100, height: 660 }, scale: 0.5 }),
    )
    manager.close(owner, 'preview-1')
  })

  it('reapplies unchanged emulation after cross-document navigation and renderer recovery', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    contents.emit('dom-ready')
    contents.emit('did-navigate', {}, 'https://example.com/new')
    manager.setBounds(owner, 'preview-1', floatingBounds)
    expect(contents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
    contents.emit('dom-ready')
    expect(contents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    manager.setBounds(owner, 'preview-1', floatingBounds)
    expect(contents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
    contents.emit('dom-ready')
    expect(contents.enableDeviceEmulation).toHaveBeenCalledTimes(3)
    manager.close(owner, 'preview-1')
  })

  it.each([
    { isMainFrame: false, isSameDocument: false },
    { isMainFrame: true, isSameDocument: true },
  ])('does not suspend emulation for navigation %j', (details) => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    contents.emit('dom-ready')
    contents.emit('did-start-navigation', details)
    manager.setBounds(owner, 'preview-1', { ...floatingBounds, width: 160, height: 100 })
    expect(contents.enableDeviceEmulation).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: 0.125 }),
    )
    manager.close(owner, 'preview-1')
  })

  it('clears previously applied emulation when switching to fill during navigation', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    contents.emit('dom-ready')
    contents.emit('did-navigate', {}, 'https://example.com/new')
    manager.setBounds(owner, 'preview-1', { x: 0, y: 0, width: 800, height: 600 })
    expect(contents.disableDeviceEmulation).not.toHaveBeenCalled()
    contents.emit('dom-ready')
    expect(contents.disableDeviceEmulation).toHaveBeenCalledOnce()
    contents.emit('dom-ready')
    expect(contents.disableDeviceEmulation).toHaveBeenCalledOnce()
    manager.close(owner, 'preview-1')
  })

  it('removes readiness listeners when closed before initial navigation completes', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    expect(contents.listenerCount('dom-ready')).toBeGreaterThan(0)
    manager.close(owner, 'preview-1')
    for (const event of ['dom-ready', 'did-navigate', 'render-process-gone']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
    contents.emit('dom-ready')
    expect(contents.enableDeviceEmulation).not.toHaveBeenCalled()
    expect(contents.disableDeviceEmulation).not.toHaveBeenCalled()
  })

  it('keeps the existing document ready when provisional navigation is canceled', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ bounds: floatingBounds }))
    const contents = firstView().webContents
    contents.emit('dom-ready')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    contents.emit(
      'did-fail-provisional-load',
      {},
      -3,
      'ERR_ABORTED',
      'https://example.com/slow',
      true,
    )
    contents.emit('did-stop-loading')
    manager.setBounds(owner, 'preview-1', { ...floatingBounds, width: 160, height: 100 })
    expect(contents.enableDeviceEmulation).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: 0.125 }),
    )
    manager.close(owner, 'preview-1')
  })
})
