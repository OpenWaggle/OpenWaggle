import { EventEmitter } from 'node:events'
import type { BrowserPreviewOpenInput } from '@shared/types/browser-preview'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Input, WebContents } from 'electron'
import { vi } from 'vitest'

interface FakeNavigationHistory {
  readonly canGoBack: ReturnType<typeof vi.fn>
  readonly canGoForward: ReturnType<typeof vi.fn>
  readonly goBack: ReturnType<typeof vi.fn>
  readonly goForward: ReturnType<typeof vi.fn>
}

interface FakeSession {
  readonly setPermissionCheckHandler: ReturnType<typeof vi.fn>
  readonly setPermissionRequestHandler: ReturnType<typeof vi.fn>
  readonly setDevicePermissionHandler: ReturnType<typeof vi.fn>
  readonly setDisplayMediaRequestHandler: ReturnType<typeof vi.fn>
  readonly setBluetoothPairingHandler: ReturnType<typeof vi.fn>
  readonly getUserAgent: ReturnType<typeof vi.fn>
  readonly setUserAgent: ReturnType<typeof vi.fn>
  readonly fetch: ReturnType<typeof vi.fn>
}

interface FakePreviewContents extends EventEmitter {
  readonly session: FakeSession
  readonly navigationHistory: FakeNavigationHistory
  readonly loadURL: ReturnType<typeof vi.fn>
  readonly reload: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly getZoomFactor: ReturnType<typeof vi.fn>
  readonly setZoomFactor: ReturnType<typeof vi.fn>
  readonly setAudioMuted: ReturnType<typeof vi.fn>
  readonly enableDeviceEmulation: ReturnType<typeof vi.fn>
  readonly disableDeviceEmulation: ReturnType<typeof vi.fn>
  readonly setIgnoreMenuShortcuts: ReturnType<typeof vi.fn>
  readonly isFocused: ReturnType<typeof vi.fn>
  readonly setWindowOpenHandler: ReturnType<typeof vi.fn>
  readonly executeJavaScriptInIsolatedWorld: ReturnType<typeof vi.fn>
  currentUrl: string
  currentTitle: string
  destroyed: boolean
  loading: boolean
  windowOpenHandler:
    | ((details: { readonly disposition: string; readonly url: string }) => {
        readonly action: string
      })
    | null
}

export interface FakePreviewView {
  readonly webContents: FakePreviewContents
  readonly setBounds: ReturnType<typeof vi.fn>
  readonly setVisible: ReturnType<typeof vi.fn>
  readonly constructorOptions: {
    readonly webPreferences?: { readonly [key: string]: unknown }
  }
}

export interface BrowserPreviewElectronMocks {
  readonly createdViews: FakePreviewView[]
  readonly windowFromWebContents: ReturnType<typeof vi.fn>
}

const electronMocks: BrowserPreviewElectronMocks = vi.hoisted(() => {
  const createdViews: FakePreviewView[] = []
  return {
    createdViews,
    windowFromWebContents: vi.fn(),
  }
})

const browserPreviewOwnerRegistryMock = vi.hoisted(() => ({
  assertRegistered: vi.fn(),
  notifyMaterialized: vi.fn(),
  requestOpen: vi.fn(),
}))

interface BrowserPreviewOwnerRegistryMock {
  readonly assertRegistered: ReturnType<typeof vi.fn>
  readonly notifyMaterialized: ReturnType<typeof vi.fn>
  readonly requestOpen: ReturnType<typeof vi.fn>
}

export function getBrowserPreviewOwnerRegistryMock(): BrowserPreviewOwnerRegistryMock {
  return browserPreviewOwnerRegistryMock
}

export function getBrowserPreviewElectronMocks(): BrowserPreviewElectronMocks {
  return electronMocks
}

vi.mock('electron', async () => {
  const { EventEmitter: RuntimeEventEmitter } = await import('node:events')

  class FakeSessionImpl extends RuntimeEventEmitter implements FakeSession {
    readonly setPermissionCheckHandler = vi.fn()
    readonly setPermissionRequestHandler = vi.fn()
    readonly setDevicePermissionHandler = vi.fn()
    readonly setDisplayMediaRequestHandler = vi.fn()
    readonly setBluetoothPairingHandler = vi.fn()
    readonly getUserAgent = vi.fn(() => 'Mozilla/5.0 Electron/38.0 OpenWaggle/1.0')
    readonly setUserAgent = vi.fn()
    readonly fetch = vi.fn()
  }

  class FakePreviewContentsImpl extends RuntimeEventEmitter implements FakePreviewContents {
    readonly session = new FakeSessionImpl()
    readonly navigationHistory = {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    }
    readonly loadURL = vi.fn((url: string) => {
      this.currentUrl = url
      return Promise.resolve()
    })
    readonly reload = vi.fn()
    readonly stop = vi.fn(() => {
      this.loading = false
    })
    readonly close = vi.fn(() => {
      this.destroyed = true
      this.emit('destroyed')
    })
    readonly getZoomFactor = vi.fn(() => this.zoomFactor)
    readonly setZoomFactor = vi.fn((zoomFactor: number) => {
      this.zoomFactor = zoomFactor
    })
    readonly setAudioMuted = vi.fn()
    readonly enableDeviceEmulation = vi.fn()
    readonly disableDeviceEmulation = vi.fn()
    readonly setIgnoreMenuShortcuts = vi.fn()
    readonly isFocused = vi.fn(() => false)
    readonly setWindowOpenHandler = vi.fn(
      (
        handler: (details: { readonly disposition: string; readonly url: string }) => {
          readonly action: string
        },
      ) => {
        this.windowOpenHandler = handler
      },
    )
    readonly executeJavaScriptInIsolatedWorld = vi.fn(() => Promise.resolve(null))
    currentUrl = ''
    currentTitle = ''
    destroyed = false
    loading = false
    zoomFactor = 1
    windowOpenHandler:
      | ((details: { readonly disposition: string; readonly url: string }) => {
          readonly action: string
        })
      | null = null

    isDestroyed() {
      return this.destroyed
    }

    getURL() {
      return this.currentUrl
    }

    getTitle() {
      return this.currentTitle
    }

    isLoading() {
      return this.loading
    }
  }

  class FakeWebContentsView implements FakePreviewView {
    readonly webContents = new FakePreviewContentsImpl()
    readonly setBounds = vi.fn()
    readonly setVisible = vi.fn()

    constructor(
      readonly constructorOptions: {
        readonly webPreferences?: { readonly [key: string]: unknown }
      },
    ) {
      electronMocks.createdViews.push(this)
    }
  }

  return {
    BrowserWindow: { fromWebContents: electronMocks.windowFromWebContents },
    WebContentsView: FakeWebContentsView,
  }
})

vi.mock('../desktop-ui', () => ({
  isAutomationMode: () => false,
  browserWindowFromWebContents: electronMocks.windowFromWebContents,
  createBrowserWindow: vi.fn(),
}))

vi.mock('../browser-preview-owner-registry', () => ({
  browserPreviewOwnerRegistry: browserPreviewOwnerRegistryMock,
}))

const browserPreviewModule = await import('../browser-preview')

export const BrowserPreviewManager = browserPreviewModule.BrowserPreviewManager
export const browserPreviewShortcutForInput = browserPreviewModule.browserPreviewShortcutForInput

export function previewInput(overrides: Partial<Input> = {}): Input {
  return {
    type: 'keyDown',
    key: 'l',
    code: 'KeyL',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: true,
    location: 0,
    modifiers: [],
    ...overrides,
  }
}

export interface BrowserPreviewOwnerFixture {
  readonly emitter: EventEmitter
  readonly focus: ReturnType<typeof vi.fn>
  readonly owner: WebContents
  readonly send: ReturnType<typeof vi.fn>
}

export function createOwner(id = 17): BrowserPreviewOwnerFixture {
  const emitter = new EventEmitter()
  const focus = vi.fn()
  const send = vi.fn()
  const owner = fromPartial<WebContents>({
    id,
    focus,
    isDestroyed: () => false,
    send,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  })
  return { emitter, focus, owner, send }
}

export interface BrowserPreviewWindowFixture {
  readonly addChildView: ReturnType<typeof vi.fn>
  readonly emitter: EventEmitter
  readonly removeChildView: ReturnType<typeof vi.fn>
  readonly window: {
    readonly contentView: {
      readonly addChildView: ReturnType<typeof vi.fn>
      readonly removeChildView: ReturnType<typeof vi.fn>
    }
    readonly isDestroyed: () => boolean
    readonly once: EventEmitter['once']
    readonly removeListener: EventEmitter['removeListener']
  }
}

export function createWindow(): BrowserPreviewWindowFixture {
  const emitter = new EventEmitter()
  const addChildView = vi.fn()
  const removeChildView = vi.fn()
  return {
    addChildView,
    emitter,
    removeChildView,
    window: {
      contentView: { addChildView, removeChildView },
      isDestroyed: () => false,
      once: emitter.once.bind(emitter),
      removeListener: emitter.removeListener.bind(emitter),
    },
  }
}

export function openInput(
  overrides: Partial<BrowserPreviewOpenInput> = {},
): BrowserPreviewOpenInput {
  return {
    previewId: 'preview-1',
    ownerKey: 'session-1',
    profileId: 'default',
    url: 'https://example.com',
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    visible: true,
    ...overrides,
  }
}

export function firstView() {
  const view = electronMocks.createdViews[0]
  if (!view) throw new Error('Expected a browser preview view.')
  return view
}
