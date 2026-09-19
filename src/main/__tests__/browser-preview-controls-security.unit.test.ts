import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewManager,
  browserPreviewShortcutForInput,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
  openInput,
  previewInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()
const browserPreviewOwnerRegistryMock = getBrowserPreviewOwnerRegistryMock()

describe('browser preview controls and page security', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    browserPreviewOwnerRegistryMock.assertRegistered.mockReset()
    browserPreviewOwnerRegistryMock.notifyMaterialized.mockReset()
  })

  it('hides without destroying and shows again with new bounds', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    manager.setBounds(owner, 'preview-1', null)
    manager.setBounds(owner, 'preview-1', { x: 1, y: 2, width: 300, height: 200 })

    expect(view.setVisible).toHaveBeenNthCalledWith(2, false)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 1, y: 2, width: 300, height: 200 })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.webContents.close).not.toHaveBeenCalled()
  })

  it('scales a floating fill-mode page without mutating its viewport preference', () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()
    view.webContents.emit('dom-ready')
    manager.setBounds(owner, 'preview-1', {
      x: 20,
      y: 20,
      width: 320,
      height: 200,
      sourceViewport: { width: 1280, height: 800 },
    })
    expect(view.webContents.enableDeviceEmulation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        viewSize: { width: 1280, height: 800 },
        scale: 0.25,
      }),
    )
    manager.setBounds(owner, 'preview-1', { x: 20, y: 20, width: 800, height: 600 })
    expect(view.webContents.disableDeviceEmulation).toHaveBeenCalledOnce()
    manager.close(owner, 'preview-1')
  })

  it('reuses the view for a different URL and denies all popup windows', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    const result = view.webContents.windowOpenHandler?.({
      disposition: 'foreground-tab',
      url: 'https://openwaggle.dev/docs',
    })

    expect(result).toEqual({ action: 'deny' })
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://openwaggle.dev/docs')
    expect(electronMocks.createdViews).toHaveLength(1)
  })

  it('blocks non-network navigation before it commits', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const preventDefault = vi.fn()

    firstView().webContents.emit('will-navigate', {
      url: 'file:///etc/passwd',
      isMainFrame: true,
      preventDefault,
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({ error: expect.objectContaining({ code: 'BLOCKED_NAVIGATION' }) }),
    )
  })

  it('blocks page-authored host window bounds changes', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const preventDefault = vi.fn()

    firstView().webContents.emit(
      'content-bounds-updated',
      { preventDefault },
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    )

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('ignores page-authored unload prevention', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const preventDefault = vi.fn()

    firstView().webContents.emit('will-prevent-unload', { preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('settles client-certificate prompts by explicitly rejecting every certificate', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const preventDefault = vi.fn()
    const callback = vi.fn()

    firstView().webContents.emit(
      'select-client-certificate',
      { preventDefault },
      'https://example.com/',
      [],
      callback,
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledExactlyOnceWith()
  })

  it('routes native-focus shortcuts and handles history controls locally', () => {
    const { focus, owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()
    view.webContents.navigationHistory.canGoBack.mockReturnValue(true)
    const preventDefault = vi.fn()

    view.webContents.emit(
      'before-input-event',
      { preventDefault },
      previewInput({ meta: process.platform === 'darwin', control: process.platform !== 'darwin' }),
    )
    view.webContents.emit(
      'before-input-event',
      { preventDefault },
      previewInput({ key: 'ArrowLeft', code: 'ArrowLeft', meta: false, alt: true }),
    )

    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('browser-preview:shortcut', {
      previewId: 'preview-1',
      action: 'focus-location',
    })
    expect(focus).toHaveBeenCalledOnce()
    expect(view.webContents.navigationHistory.goBack).toHaveBeenCalledOnce()
  })

  it('applies bounded zoom changes to the owned native preview', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    expect(manager.zoom(owner, 'preview-1', 'in')).toBe(1.1)
    expect(view.webContents.setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(manager.zoom(owner, 'preview-1', 'reset')).toBe(1)
    expect(view.webContents.setZoomFactor).toHaveBeenLastCalledWith(1)
  })
})

describe('browserPreviewShortcutForInput', () => {
  it('maps macOS and non-macOS primary shortcuts without accepting repeats', () => {
    expect(browserPreviewShortcutForInput(previewInput(), true)).toBe('focus-location')
    expect(
      browserPreviewShortcutForInput(
        previewInput({ key: 'w', code: 'KeyW', meta: false, control: true }),
        false,
      ),
    ).toBe('close')
    expect(browserPreviewShortcutForInput(previewInput({ isAutoRepeat: true }), true)).toBeNull()
  })
})
