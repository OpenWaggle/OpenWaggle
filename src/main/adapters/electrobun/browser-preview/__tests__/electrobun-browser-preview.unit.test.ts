import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_PNG, fakeCefBrowser } from './fake-cef-browser'
import { fakeElectrobun } from '../../__tests__/contracts/fake-electrobun'
import { makeElectrobunBrowserPreviewViews } from '../electrobun-browser-preview-shape'
import { electrobunOwnerWindow } from '../electrobun-owner-windows'
import type { ElectrobunPreviewHost } from '../electrobun-preview-record-factory'

vi.mock('../../../../desktop-native-admission', () => ({
  assertDesktopNativeAdmission: () => undefined,
}))

const OWNER_KEY = 'session:s-1'
const BOUNDS = { x: 10, y: 20, width: 400, height: 300 }

function setup(options: { readonly cdp?: boolean } = {}) {
  const electrobun = fakeElectrobun()
  const cef = fakeCefBrowser()
  const frames = { setFrame: vi.fn(), setHidden: vi.fn() }
  const artifacts = {
    write: vi.fn(async (_kind: string, _extension: string, _data: Uint8Array) => ({
      id: 'shot',
      path: '/artifacts/shot.png',
    })),
    resolveOwnedArtifact: vi.fn(async (artifactPath: string) => artifactPath),
  }
  const revealInFolder = vi.fn()
  const writeClipboardImage = vi.fn(async (_png: Uint8Array) => undefined)
  const host: ElectrobunPreviewHost = {
    createView: cef.createView,
    frames,
    endpoint: () => (options.cdp === false ? null : cef.endpoint),
    openSocket: cef.openSocket,
    ownerWindowOf: (owner) =>
      electrobunOwnerWindow(
        {
          BrowserView: electrobun.module.BrowserView,
          BrowserWindow: electrobun.module.BrowserWindow,
          events: electrobun.events,
        },
        owner.id,
      ),
    maintenanceWindowId: () => new electrobun.module.BrowserWindow({ hidden: true }).id,
    artifacts: () => fromPartial(artifacts),
    revealInFolder,
    writeClipboardImage,
    isMac: true,
  }
  const views = makeElectrobunBrowserPreviewViews(host)
  const page = electrobun.browserPreview.openOwnerPage()
  const sent: [string, unknown][] = []
  page.surface.send = (channel: string, payload: unknown) => void sent.push([channel, payload])
  views.registerOwner(OWNER_KEY, page.surface)
  return { views, cef, frames, page, sent, artifacts, revealInFolder, writeClipboardImage }
}

type Setup = ReturnType<typeof setup>

function openPreview({ views, page }: Setup, previewId = 'p-1', url = 'https://example.com/') {
  return views.open(page.surface, {
    previewId,
    ownerKey: OWNER_KEY,
    profileId: 'default',
    url,
    bounds: BOUNDS,
    visible: true,
  })
}

function lastState(sent: Setup['sent']): unknown {
  return sent.filter(([channel]) => channel === 'browser-preview:state').at(-1)?.[1]
}

function onlyView(harness: Setup) {
  const [view] = harness.cef.views()
  if (view === undefined) throw new Error('No preview view')
  return view
}

const settle = () => vi.advanceTimersByTimeAsync(50)

describe('Electrobun Browser preview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a sandboxed CEF view in the owner window and loads the page over CDP', async () => {
    const harness = setup()
    const state = openPreview(harness)
    expect(state).toMatchObject({ url: 'https://example.com/', loading: true })

    const [view] = harness.cef.views()
    expect(view?.options).toMatchObject({
      windowId: harness.page.window.id,
      partition: 'persist:openwaggle-browser-preview',
    })
    expect(view?.options.url).toMatch(/^about:blank#openwaggle-preview-[0-9a-f]{32}$/)
    expect(harness.frames.setFrame).toHaveBeenCalledWith(view?.id, BOUNDS)
    expect(harness.frames.setHidden).toHaveBeenCalledWith(view?.id, false)

    await settle()
    expect(harness.cef.sent('Page.navigate').map((command) => command.params)).toEqual([
      { url: 'https://example.com/' },
    ])
    expect(harness.cef.sent('Runtime.addBinding')).toHaveLength(1)
    expect(lastState(harness.sent)).toMatchObject({ url: 'https://example.com/', loading: false })
  })

  it('reports navigation, title and history, and goes back', async () => {
    const harness = setup()
    openPreview(harness)
    await settle()
    harness.views.navigate(harness.page.surface, 'p-1', 'https://example.com/next')
    await settle()
    expect(lastState(harness.sent)).toMatchObject({
      url: 'https://example.com/next',
      canGoBack: true,
    })

    harness.cef.emit(onlyView(harness), 'Runtime.bindingCalled', {
      name: '__openwaggleBrowserPreviewHost',
      payload: JSON.stringify({ kind: 'title', title: 'Next page' }),
    })
    expect(lastState(harness.sent)).toMatchObject({ title: 'Next page' })

    harness.views.goBack(harness.page.surface, 'p-1')
    await settle()
    // The earlier document reports its own title once it loads.
    expect(lastState(harness.sent)).toMatchObject({
      url: 'https://example.com/',
      canGoBack: false,
      title: '',
    })
  })

  it('hides the view without bounds and zooms through device metrics', async () => {
    const harness = setup()
    openPreview(harness)
    await settle()
    const [view] = harness.cef.views()
    harness.views.setBounds(harness.page.surface, 'p-1', null)
    expect(harness.frames.setHidden).toHaveBeenLastCalledWith(view?.id, true)

    harness.views.setBounds(harness.page.surface, 'p-1', BOUNDS)
    expect(harness.views.zoom(harness.page.surface, 'p-1', 'in')).toBeGreaterThan(1)
    await settle()
    expect(harness.cef.sent('Emulation.setDeviceMetricsOverride').at(-1)?.params).toMatchObject({
      width: Math.round(BOUNDS.width / 1.1),
      deviceScaleFactor: 0,
    })
  })

  it('stores a screenshot artifact with the PNG dimensions', async () => {
    const harness = setup()
    openPreview(harness)
    await settle()
    const artifact = await harness.views.captureScreenshot(harness.page.surface, 'p-1')
    expect(artifact).toMatchObject({ previewId: 'p-1', width: 2, height: 3, mimeType: 'image/png' })
    const [kind, extension, data] = harness.artifacts.write.mock.calls[0] ?? []
    expect([kind, extension, Uint8Array.from(data ?? [])]).toEqual(['screenshot', 'png', FAKE_PNG])
  })

  it('loads the page through the view when the app has no DevTools port', async () => {
    const harness = setup({ cdp: false })
    openPreview(harness)
    await settle()
    const [view] = harness.cef.views()
    expect(view?.loadedUrls).toEqual(['https://example.com/'])
    await expect(harness.views.captureScreenshot(harness.page.surface, 'p-1')).rejects.toThrow(
      /no DevTools connection/,
    )
  })

  it('forwards a claimed shortcut to the owner page', async () => {
    const harness = setup()
    openPreview(harness)
    await settle()
    harness.views.setShortcutBindings(harness.page.surface, [{ key: 'k', mod: true }])
    harness.cef.emit(onlyView(harness), 'Runtime.bindingCalled', {
      name: '__openwaggleBrowserPreviewHost',
      payload: JSON.stringify({
        kind: 'key',
        type: 'keyDown',
        key: 'k',
        code: 'KeyK',
        location: 0,
        alt: false,
        control: false,
        meta: true,
        shift: false,
        isComposing: false,
        isAutoRepeat: false,
      }),
    })
    expect(harness.sent.some(([channel]) => channel === 'browser-preview:key-event')).toBe(true)
  })

  it('removes the view on close and when the owner window closes', async () => {
    const harness = setup()
    openPreview(harness, 'p-1')
    openPreview(harness, 'p-2', 'https://example.com/two')
    await settle()
    const [first, second] = harness.cef.views()
    await harness.views.close(harness.page.surface, 'p-1')
    expect(first?.removed).toBe(true)
    expect(harness.views.ownedPreviewCount(OWNER_KEY)).toBe(1)

    harness.page.window.close()
    expect(second?.removed).toBe(true)
    expect(harness.views.ownedPreviewCount(OWNER_KEY)).toBe(0)
    expect(harness.views.isOwnerRegistered(OWNER_KEY)).toBe(false)
  })

  it('refuses a ninth preview for one owner', async () => {
    const harness = setup()
    for (let index = 0; index < 8; index += 1) openPreview(harness, `p-${String(index)}`)
    expect(() => openPreview(harness, 'p-8')).toThrow()
  })

  it('sets imported cookies and clears profile data over CDP', async () => {
    const harness = setup()
    const jar = harness.views.profileCookieJar('default')
    const set = jar.cookies.set({
      url: 'https://example.com/',
      name: 'sid',
      value: 'v',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 2_000_000_000,
    })
    await settle()
    await set
    expect(harness.cef.sent('Network.setCookie')[0]?.params).toEqual({
      url: 'https://example.com/',
      name: 'sid',
      value: 'v',
      path: '/',
      secure: true,
      httpOnly: true,
      expires: 2_000_000_000,
      sameSite: 'Lax',
    })
    const flushed = jar.cookies.flushStore()
    await settle()
    await flushed
    expect(harness.cef.views()[0]?.options.partition).toBe('persist:openwaggle-browser-preview')
    expect(harness.cef.views()[0]?.removed).toBe(true)

    const cleared = harness.views.clearProfileData('default')
    await settle()
    await cleared
    expect(harness.cef.sent('Storage.clearDataForOrigin').map((command) => command.params)).toEqual(
      [
        { origin: 'https://example.com', storageTypes: 'all' },
        { origin: 'http://example.com', storageTypes: 'all' },
      ],
    )
  })
})
