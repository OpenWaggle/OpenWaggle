import type { WebContents } from 'electron'
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
const browserPreviewOwnerRegistryMock = getBrowserPreviewOwnerRegistryMock()

describe('browser preview ownership and capacity', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    browserPreviewOwnerRegistryMock.assertRegistered.mockReset()
    browserPreviewOwnerRegistryMock.notifyMaterialized.mockReset()
  })

  it('creates a hardened view and denies browser permissions', () => {
    const { owner, send } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    const state = manager.open(owner, openInput())
    const view = firstView()

    expect(view.constructorOptions.webPreferences).toMatchObject({
      partition: 'persist:openwaggle-browser-preview',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      enableWebSQL: false,
      navigateOnDragDrop: false,
      disableDialogs: true,
      disableHtmlFullscreenWindowResize: true,
      devTools: true,
      plugins: false,
    })
    expect(view.webContents.session.setPermissionCheckHandler).toHaveBeenCalledOnce()
    expect(view.webContents.session.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(view.webContents.session.setDevicePermissionHandler).toHaveBeenCalledOnce()
    expect(view.webContents.session.setDisplayMediaRequestHandler).toHaveBeenCalledOnce()
    expect(view.webContents.session.setBluetoothPairingHandler).toHaveBeenCalledOnce()
    expect(view.webContents.setIgnoreMenuShortcuts).toHaveBeenCalledExactlyOnceWith(true)
    expect(state).toMatchObject({ url: 'https://example.com/', loading: true, error: null })
    expect(send).toHaveBeenCalledWith('browser-preview:state', state)
  })

  it('applies persisted starting controls before the first page load', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    const state = manager.open(
      owner,
      openInput({
        initialControls: {
          viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
          zoomFactor: 1.25,
          appearance: 'dark',
        },
      }),
    )
    const view = firstView()

    expect(view.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.25)
    expect(view.webContents.setZoomFactor.mock.invocationCallOrder[0]).toBeLessThan(
      view.webContents.loadURL.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(state.controls).toMatchObject({
      viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
      zoomFactor: 1.25,
      appearance: 'dark',
    })
  })

  it('reuses an existing preview without reloading the same canonical URL', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    manager.open(owner, openInput())
    manager.open(
      owner,
      openInput({ bounds: { x: 30, y: 40, width: 700, height: 500 }, visible: false }),
    )

    const view = firstView()
    expect(electronMocks.createdViews).toHaveLength(1)
    expect(view.webContents.loadURL).toHaveBeenCalledOnce()
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 30, y: 40, width: 700, height: 500 })
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('scopes automation navigation completion and stop to one load generation', async () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    const view = firstView()
    let resolveLoad: (() => void) | undefined
    const loadCompletion = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    view.webContents.loadURL.mockReturnValueOnce(loadCompletion)

    const operation = manager.beginAutomationNavigation(
      owner,
      'preview-1',
      'https://openwaggle.dev/automation',
    )

    expect(operation.isCurrent()).toBe(true)
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://openwaggle.dev/automation')
    manager.navigate(owner, 'preview-1', 'https://openwaggle.dev/newer')
    expect(operation.isCurrent()).toBe(false)
    operation.stop()
    expect(view.webContents.stop).not.toHaveBeenCalled()
    resolveLoad?.()
    await operation.completion
  })

  it('requires the session owner binding and tracks an explicit current preview', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    manager.open(owner, openInput())
    manager.open(owner, openInput({ previewId: 'preview-2', url: 'https://openwaggle.dev' }))

    expect(browserPreviewOwnerRegistryMock.assertRegistered).toHaveBeenNthCalledWith(
      1,
      'session-1',
      owner,
    )
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-2')

    manager.setCurrentPreview(owner, 'session-1', 'preview-1')
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-1')

    manager.close(owner, 'preview-1')
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-2')
  })

  it('fails before native view creation when the owner binding is rejected', () => {
    const { owner } = createOwner()
    browserPreviewOwnerRegistryMock.assertRegistered.mockImplementationOnce(() => {
      throw new Error('Browser-preview owner is not registered to this renderer.')
    })
    const manager = new BrowserPreviewManager()

    expect(() => manager.open(owner, openInput())).toThrow('not registered')
    expect(electronMocks.createdViews).toHaveLength(0)
  })

  it('keeps equal preview IDs isolated between renderer owners', () => {
    const firstOwner = createOwner(1)
    const secondOwner = createOwner(2)
    const firstWindow = createWindow()
    const secondWindow = createWindow()
    electronMocks.windowFromWebContents.mockImplementation((sender: WebContents) =>
      sender.id === firstOwner.owner.id ? firstWindow.window : secondWindow.window,
    )
    const manager = new BrowserPreviewManager()

    manager.open(firstOwner.owner, openInput())
    manager.open(
      secondOwner.owner,
      openInput({ ownerKey: 'session-2', url: 'https://openwaggle.dev' }),
    )

    expect(electronMocks.createdViews).toHaveLength(2)
    expect(firstOwner.send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({ url: 'https://example.com/' }),
    )
    expect(firstOwner.send).not.toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({ url: 'https://openwaggle.dev/' }),
    )
    expect(secondOwner.send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({ url: 'https://openwaggle.dev/' }),
    )
  })

  it('retains eight previews per Session and admits a background Session after the first is full', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    for (let index = 0; index < 8; index += 1) {
      manager.open(
        owner,
        openInput({
          ownerKey: 'session-1',
          previewId: `session-1-preview-${String(index)}`,
        }),
      )
    }
    manager.open(
      owner,
      openInput({ ownerKey: 'session-2', previewId: 'session-2-background-preview' }),
    )
    for (let index = 1; index < 8; index += 1) {
      manager.open(
        owner,
        openInput({
          ownerKey: 'session-2',
          previewId: `session-2-preview-${String(index)}`,
        }),
      )
    }

    expect(manager.listOwnedPreviews('session-1')).toHaveLength(8)
    expect(manager.listOwnedPreviews('session-2')).toHaveLength(8)
    expect(manager.findOwnedPreview('session-2')?.previewId).toBe('session-2-preview-7')
    expect(electronMocks.createdViews).toHaveLength(16)
  })

  it('rejects a ninth retained preview for one Session owner', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    for (let index = 0; index < 8; index += 1) {
      manager.open(owner, openInput({ previewId: `preview-${String(index)}` }))
    }

    expect(() => manager.open(owner, openInput({ previewId: 'preview-9' }))).toThrow(
      'owner may retain at most 8 previews',
    )
    expect(electronMocks.createdViews).toHaveLength(8)
  })

  it('rejects a thirty-third retained native preview in one renderer', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()

    for (let ownerIndex = 0; ownerIndex < 4; ownerIndex += 1) {
      for (let previewIndex = 0; previewIndex < 8; previewIndex += 1) {
        manager.open(
          owner,
          openInput({
            ownerKey: `session-${String(ownerIndex)}`,
            previewId: `preview-${String(ownerIndex)}-${String(previewIndex)}`,
          }),
        )
      }
    }

    expect(() =>
      manager.open(owner, openInput({ ownerKey: 'session-5', previewId: 'renderer-preview-33' })),
    ).toThrow('renderer may retain at most 32 browser previews')
    expect(electronMocks.createdViews).toHaveLength(32)
  })
})
