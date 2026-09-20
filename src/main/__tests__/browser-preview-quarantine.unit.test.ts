import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'
import { browserPreviewAutomationPage } from '../browser-preview-automation-page'
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
const { browserPreviewAutomationStatusFor } = await import(
  '../adapters/electron-browser-preview-automation-records'
)

describe('retired browser owner quarantine', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
  })

  it('hides and revokes a still-live preview after renderer crash without losing close retry', async () => {
    const manager = new BrowserPreviewManager()
    const { owner, emitter, send } = createOwner()
    const window = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(window.window)
    manager.open(owner, openInput())
    const record = manager.findOwnedPreview('session-1', 'preview-1')
    if (!record) throw new Error('Expected original preview')
    const cachedPage = browserPreviewAutomationPage(record)
    const view = firstView()
    const closeDevTools = vi.fn()
    Object.defineProperties(view.webContents, {
      isDevToolsOpened: { value: () => true },
      closeDevTools: { value: closeDevTools },
    })
    view.webContents.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    await expect(manager.close(owner, 'preview-1')).rejects.toThrow('close failed')
    emitter.emit('render-process-gone', {}, { reason: 'crashed' })
    await Promise.resolve()
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    for (const event of ['will-navigate', 'will-redirect', 'will-prevent-unload']) {
      const preventDefault = vi.fn()
      view.webContents.emit(event, { preventDefault, isMainFrame: true, url: 'https://safe.test/' })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    const preventDefault = vi.fn()
    const auth = vi.fn()
    const certificate = vi.fn()
    const bluetooth = vi.fn()
    const clientCertificate = vi.fn()
    view.webContents.emit('login', { preventDefault }, {}, {}, auth)
    view.webContents.emit('certificate-error', { preventDefault }, '', '', {}, certificate)
    view.webContents.emit('select-bluetooth-device', { preventDefault }, [], bluetooth)
    view.webContents.emit(
      'select-client-certificate',
      { preventDefault },
      '',
      [],
      clientCertificate,
    )
    expect(auth).toHaveBeenCalledWith()
    expect(certificate).toHaveBeenCalledWith(false)
    expect(bluetooth).toHaveBeenCalledWith('')
    expect(clientCertificate).toHaveBeenCalledWith()
    expect(preventDefault).toHaveBeenCalledTimes(4)
    expect(window.removeChildView).toHaveBeenCalledWith(view)
    expect(closeDevTools).toHaveBeenCalledOnce()
    expect(view.webContents.setAudioMuted).toHaveBeenLastCalledWith(true)
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
    expect(manager.listOwnedPreviews('session-1')).toEqual([])
    expect(browserPreviewAutomationStatusFor(record)).toMatchObject({
      available: false,
      visible: false,
    })
    expect(() => manager.setBounds(owner, 'preview-1', openInput().bounds)).toThrow()
    expect(() => manager.reload(owner, 'preview-1')).toThrow()
    expect(() => manager.captureScreenshot(owner, 'preview-1')).toThrow()
    await expect(manager.startRecording(owner, 'preview-1')).rejects.toThrow()
    expect(() => manager.setShortcutBindings(owner, [])).toThrow()
    expect(() => manager.setCurrentPreview(owner, 'session-1', 'preview-1')).toThrow()
    expect(() => manager.close(createOwner(18).owner, 'preview-1')).toThrow('not owned')
    manager.setBounds(owner, 'preview-1', null)
    const action = vi.fn(async () => undefined)
    await expect(
      new BrowserPreviewAutomationController().run(cachedPage, 'capture', action),
    ).rejects.toThrow('retired')
    expect(action).not.toHaveBeenCalled()
    send.mockClear()
    view.webContents.emit('did-stop-loading')
    view.webContents.emit('dom-ready')
    expect(send).not.toHaveBeenCalled()
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    view.webContents.close.mockImplementationOnce(() => {
      view.webContents.destroyed = true
      view.webContents.emit('destroyed')
    })
    await manager.close(owner, 'preview-1')
    expect(view.webContents.destroyed).toBe(true)
    expect(view.webContents.listenerCount('login')).toBe(0)
    expect(view.webContents.listenerCount('will-navigate')).toBe(0)
  })

  it('quarantines a pending close before untrusted navigation and still completes destruction', async () => {
    const manager = new BrowserPreviewManager()
    const { owner, emitter, send } = createOwner()
    const window = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(window.window)
    manager.open(owner, openInput())
    const view = firstView()
    view.webContents.close.mockImplementationOnce(() => undefined)
    const pending = manager.close(owner, 'preview-1')
    emitter.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://untrusted.test/',
    })
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(window.removeChildView).toHaveBeenCalledWith(view)
    expect(manager.findOwnedPreview('session-1')).toBeUndefined()
    expect(() => manager.navigate(owner, 'preview-1', 'https://target.test/')).toThrow()
    expect(() => manager.setBounds(owner, 'preview-1', openInput().bounds)).toThrow()
    send.mockClear()
    view.webContents.emit('did-stop-loading')
    expect(send).not.toHaveBeenCalled()
    expect(view.webContents.close).toHaveBeenCalledOnce()
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await pending
    await manager.close(owner, 'preview-1')
    expect(manager.listOwnedPreviews('session-1')).toEqual([])
  })
})
