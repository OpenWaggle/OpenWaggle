import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  openInput,
  previewInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()

function primaryInput(key: string, code: string) {
  const isMac = process.platform === 'darwin'
  return previewInput({ key, code, meta: isMac, control: !isMac })
}

describe('browser preview configurable shortcut forwarding', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
  })

  it('claims a registered chord and forwards its physical down and up events', () => {
    const { focus, owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.setShortcutBindings(owner, [{ key: 'K', meta: true }])
    manager.open(owner, openInput())
    send.mockClear()
    const preventDown = vi.fn()
    const preventUp = vi.fn()

    firstView().webContents.emit(
      'before-input-event',
      { preventDefault: preventDown },
      previewInput({ key: 'k', code: 'KeyK', meta: true }),
    )
    firstView().webContents.emit(
      'before-input-event',
      { preventDefault: preventUp },
      previewInput({
        type: 'keyUp',
        key: 'k',
        code: 'KeyK',
        meta: false,
      }),
    )

    expect(preventDown).toHaveBeenCalledOnce()
    expect(preventUp).toHaveBeenCalledOnce()
    expect(send).toHaveBeenNthCalledWith(1, 'browser-preview:key-event', {
      previewId: 'preview-1',
      type: 'keydown',
      key: 'k',
      code: 'KeyK',
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      isComposing: false,
      repeat: false,
    })
    expect(send).toHaveBeenNthCalledWith(2, 'browser-preview:key-event', {
      previewId: 'preview-1',
      type: 'keyup',
      key: 'k',
      code: 'KeyK',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
    })
    expect(focus).not.toHaveBeenCalled()
  })

  it('lets a configured rule override a native preview chord without double execution', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.setShortcutBindings(owner, [{ key: 'R', mod: true }])
    manager.open(owner, openInput())
    send.mockClear()
    const preventDefault = vi.fn()

    firstView().webContents.emit(
      'before-input-event',
      { preventDefault },
      primaryInput('r', 'KeyR'),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(firstView().webContents.reload).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'browser-preview:key-event',
      expect.objectContaining({ previewId: 'preview-1', type: 'keydown', key: 'r' }),
    )
  })

  it('keeps native preview shortcuts as the fallback before a configured chord claims them', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    send.mockClear()
    const preventDefault = vi.fn()

    firstView().webContents.emit(
      'before-input-event',
      { preventDefault },
      primaryInput('r', 'KeyR'),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(firstView().webContents.reload).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalledWith('browser-preview:key-event', expect.anything())
  })

  it('leaves unregistered page input untouched', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.setShortcutBindings(owner, [{ key: 'K', meta: true }])
    manager.open(owner, openInput())
    send.mockClear()
    const preventDefault = vi.fn()

    firstView().webContents.emit(
      'before-input-event',
      { preventDefault },
      previewInput({ key: 'q', code: 'KeyQ', meta: true }),
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards held-key repeats for renderer-side suppression while blocking the page', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.setShortcutBindings(owner, [{ key: 'K', meta: true }])
    manager.open(owner, openInput())
    send.mockClear()
    const preventDefault = vi.fn()

    firstView().webContents.emit(
      'before-input-event',
      { preventDefault },
      previewInput({ key: 'k', code: 'KeyK', meta: true, isAutoRepeat: true }),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      'browser-preview:key-event',
      expect.objectContaining({ repeat: true }),
    )
  })
})
