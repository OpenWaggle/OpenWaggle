import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const browserPreviewOwnerRegistryMock = getBrowserPreviewOwnerRegistryMock()

describe('browser preview reliability and lifecycle', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    browserPreviewOwnerRegistryMock.assertRegistered.mockReset()
    browserPreviewOwnerRegistryMock.notifyMaterialized.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers a crashed preview at its latest URL with a bounded exponential reload loop', async () => {
    vi.useFakeTimers()
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.navigate(owner, 'preview-1', 'https://openwaggle.dev/latest')
    const view = firstView()

    view.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 })
    await vi.advanceTimersByTimeAsync(250)
    expect(view.webContents.reload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(view.webContents.reload).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(view.webContents.reload).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(250)

    expect(manager.findOwnedPreview('session-1', 'preview-1')?.state.url).toBe(
      'https://openwaggle.dev/latest',
    )
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(
      'browser-preview:state',
      expect.objectContaining({
        loading: false,
        error: expect.objectContaining({
          code: 'RENDERER_GONE',
          description: expect.stringContaining('stopped after three attempts'),
        }),
      }),
    )
  })

  it('stops crash recovery when the replacement navigation starts', async () => {
    vi.useFakeTimers()
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    view.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 })
    await vi.advanceTimersByTimeAsync(250)
    view.webContents.emit('did-start-navigation', {}, 'https://example.com/', false, true)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(view.webContents.reload).toHaveBeenCalledOnce()
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels crash recovery when the preview closes', async () => {
    vi.useFakeTimers()
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    view.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 })
    manager.close(owner, 'preview-1')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(view.webContents.reload).not.toHaveBeenCalled()
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes native content after a non-recoverable renderer exit', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    view.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 })

    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('destroys every native view when its renderer owner is destroyed', () => {
    const { emitter, owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.open(owner, openInput({ previewId: 'preview-2', url: 'https://openwaggle.dev' }))

    emitter.emit('destroyed')

    expect(ownerWindow.removeChildView).toHaveBeenCalledTimes(2)
    for (const view of electronMocks.createdViews)
      expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(() => manager.close(owner, 'preview-1')).not.toThrow()
  })

  it('destroys every native view when owner listener cleanup throws', () => {
    const { emitter, owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.open(owner, openInput({ previewId: 'preview-2' }))
    vi.spyOn(owner, 'removeListener').mockImplementationOnce(() => {
      throw new Error('listener teardown race')
    })

    expect(() => emitter.emit('destroyed')).not.toThrow()

    for (const view of electronMocks.createdViews) {
      expect(view.webContents.close).toHaveBeenCalledOnce()
    }
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)
  })

  it('keeps hidden Session previews alive across a trusted renderer reload', () => {
    const { emitter, owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ ownerKey: 'session-1' }))
    manager.open(
      owner,
      openInput({
        ownerKey: 'session-2',
        previewId: 'background-preview',
        url: 'https://openwaggle.dev',
        visible: false,
      }),
    )

    emitter.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'openwaggle://app/sessions/session-1',
    })

    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    expect(manager.findOwnedPreview('session-2', 'background-preview')).toBeDefined()
    for (const view of electronMocks.createdViews)
      expect(view.webContents.close).not.toHaveBeenCalled()

    emitter.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://attacker.invalid/',
    })

    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
    expect(manager.findOwnedPreview('session-2', 'background-preview')).toBeUndefined()
  })

  it('destroys every native view when its owner window closes', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.open(owner, openInput({ previewId: 'preview-2', url: 'https://openwaggle.dev' }))

    ownerWindow.emitter.emit('closed')

    expect(ownerWindow.removeChildView).toHaveBeenCalledTimes(2)
    for (const view of electronMocks.createdViews)
      expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(() => manager.close(owner, 'preview-1')).not.toThrow()
  })

  it('reports and detaches native content unexpectedly closed by a page', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()

    view.webContents.destroyed = true
    view.webContents.emit('destroyed')

    expect(send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({
        error: expect.objectContaining({ code: 'CONTENT_CLOSED' }),
      }),
    )
    expect(ownerWindow.removeChildView).toHaveBeenCalledOnce()
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(() => manager.reload(owner, 'preview-1')).toThrow('was not found')
  })

  it('destroys the native view on explicit close', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())

    manager.close(owner, 'preview-1')

    expect(ownerWindow.removeChildView).toHaveBeenCalledOnce()
    expect(firstView().webContents.close).toHaveBeenCalledOnce()
    expect(() => manager.close(owner, 'preview-1')).not.toThrow()
  })

  it('atomically releases a new native view when attachment fails', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    ownerWindow.addChildView.mockImplementationOnce(() => {
      throw new Error('native attach failed')
    })
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    expect(() => manager.open(owner, openInput())).toThrow('native attach failed')

    expect(firstView().webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('releases a partially configured native view when setup fails', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    const originalPush = electronMocks.createdViews.push.bind(electronMocks.createdViews)
    vi.spyOn(electronMocks.createdViews, 'push').mockImplementationOnce((view) => {
      const result = originalPush(view)
      view.webContents.setZoomFactor.mockImplementationOnce(() => {
        throw new Error('native setup failed')
      })
      return result
    })

    expect(() => manager.open(owner, openInput())).toThrow('native setup failed')

    expect(firstView().webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('continues native teardown when detaching the view throws', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()
    view.setVisible.mockImplementationOnce(() => {
      throw new Error('visibility teardown race')
    })
    ownerWindow.removeChildView.mockImplementationOnce(() => {
      throw new Error('detach teardown race')
    })

    expect(() => manager.close(owner, 'preview-1')).not.toThrow()

    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('continues native teardown when destroyed checks and content close throw', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()
    vi.spyOn(ownerWindow.window, 'isDestroyed').mockImplementationOnce(() => {
      throw new Error('window teardown race')
    })
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('content teardown race')
    })

    expect(() => manager.close(owner, 'preview-1')).not.toThrow()

    expect(ownerWindow.removeChildView).toHaveBeenCalledOnce()
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })
})
