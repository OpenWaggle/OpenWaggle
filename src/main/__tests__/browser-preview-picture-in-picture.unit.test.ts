import { fromPartial } from '@total-typescript/shoehorn'
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  NativeImage,
  WebContents,
} from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../desktop-ui', () => ({
  createBrowserWindow: vi.fn(),
  isAutomationMode: () => false,
  revealBrowserWindowInactive: (window: BrowserWindow) => window.showInactive(),
}))

const {
  BrowserPreviewPictureInPictureController,
  buildBrowserPreviewPictureInPictureUrl,
  fitBrowserPreviewPictureInPictureSize,
} = await import('../browser-preview-picture-in-picture')

interface WindowFixture {
  readonly closeEvent: () => void
  readonly executeJavaScript: ReturnType<typeof vi.fn>
  readonly loadURL: ReturnType<typeof vi.fn>
  readonly showInactive: ReturnType<typeof vi.fn>
  readonly window: BrowserWindow
}

function makeWindowFixture(): WindowFixture {
  let destroyed = false
  let closedListener: (() => void) | null = null
  const executeJavaScript = vi.fn(async () => true)
  const loadURL = vi.fn(async () => undefined)
  const showInactive = vi.fn()
  const webContents = fromPartial<WebContents>({
    executeJavaScript,
    isDestroyed: () => destroyed,
  })
  const window = fromPartial<BrowserWindow>({
    close: vi.fn(() => {
      if (destroyed) return
      destroyed = true
      closedListener?.()
    }),
    getContentSize: () => [480, 320],
    destroy: vi.fn(() => {
      if (destroyed) return
      destroyed = true
      closedListener?.()
    }),
    isDestroyed: () => destroyed,
    loadURL,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'closed') closedListener = listener
      return window
    }),
    setAlwaysOnTop: vi.fn(),
    setAspectRatio: vi.fn(),
    setContentSize: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    showInactive,
    webContents,
  })
  return {
    closeEvent: () => {
      destroyed = true
      closedListener?.()
    },
    executeJavaScript,
    loadURL,
    showInactive,
    window,
  }
}

function makeImage(encoded = Buffer.from([1, 2, 3])) {
  const resized = fromPartial<NativeImage>({
    getSize: () => ({ width: 960, height: 540 }),
    isEmpty: () => false,
    toJPEG: vi.fn(() => encoded),
  })
  const source = fromPartial<NativeImage>({
    getSize: () => ({ width: 1_920, height: 1_080 }),
    isEmpty: () => false,
    resize: vi.fn(() => resized),
  })
  return { resized, source }
}

function makeController(options: { readonly automation?: boolean } = {}) {
  const windowFixture = makeWindowFixture()
  const constructorOptions: BrowserWindowConstructorOptions[] = []
  const onClosed = vi.fn()
  const controller = new BrowserPreviewPictureInPictureController({
    createWindow: (nextOptions: BrowserWindowConstructorOptions) => {
      constructorOptions.push(nextOptions)
      return windowFixture.window
    },
    isAutomation: () => options.automation ?? false,
    platform: 'darwin',
    onClosed,
  })
  return { constructorOptions, controller, onClosed, windowFixture }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserPreviewPictureInPictureController', () => {
  it('creates a secure always-on-top viewer and delivers a bounded first frame', async () => {
    const { resized, source } = makeImage()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(async () => source),
      isDestroyed: () => false,
    })
    const { constructorOptions, controller, windowFixture } = makeController()

    await expect(controller.open('preview-1', target, 'Example\u0000 title')).resolves.toBe(
      'opened',
    )

    expect(constructorOptions[0]).toMatchObject({
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
      title: 'Preview · Example  title',
      type: 'panel',
      webPreferences: {
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    expect(source.resize).toHaveBeenCalledWith({ width: 960, height: 540, quality: 'good' })
    expect(resized.toJPEG).toHaveBeenCalledWith(75)
    expect(windowFixture.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('data:image/jpeg;base64,AQID'),
    )
    expect(windowFixture.showInactive).toHaveBeenCalledOnce()
    expect(controller.isOpen('preview-1')).toBe(true)
  })

  it('serializes capture ticks and suppresses duplicate frames', async () => {
    vi.useFakeTimers()
    const { source } = makeImage()
    const capturePage = vi.fn(async () => source)
    const target = fromPartial<WebContents>({ capturePage, isDestroyed: () => false })
    const { controller, windowFixture } = makeController()
    await controller.open('preview-1', target, 'Example')

    await vi.advanceTimersByTimeAsync(100)

    expect(capturePage).toHaveBeenCalledTimes(2)
    expect(windowFixture.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('stops the frame loop after a terminal native capture failure', async () => {
    vi.useFakeTimers()
    const { source } = makeImage()
    const capturePage = vi
      .fn<WebContents['capturePage']>()
      .mockResolvedValueOnce(source)
      .mockRejectedValue(new Error('compositor unavailable'))
    const target = fromPartial<WebContents>({ capturePage, isDestroyed: () => false })
    const { controller } = makeController()
    await controller.open('preview-1', target, 'Example')

    await vi.advanceTimersByTimeAsync(500)

    expect(capturePage).toHaveBeenCalledTimes(4)
    expect(controller.isOpen('preview-1')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a hidden window when its first native frame stalls', async () => {
    vi.useFakeTimers()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(() => new Promise<NativeImage>(() => undefined)),
      invalidate: vi.fn(),
      isDestroyed: () => false,
    })
    const { controller, windowFixture } = makeController()
    const opening = controller.open('preview-1', target, 'Example')
    const failedOpening = expect(opening).rejects.toThrow(
      'Browser preview capture did not finish after 3 bounded attempts.',
    )

    await vi.advanceTimersByTimeAsync(3_500)

    await failedOpening
    expect(controller.isOpen('preview-1')).toBe(false)
    expect(windowFixture.showInactive).not.toHaveBeenCalled()
  })

  it('releases a hidden window when its local viewer document stalls', async () => {
    vi.useFakeTimers()
    const { source } = makeImage()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(async () => source),
      isDestroyed: () => false,
    })
    const { controller, windowFixture } = makeController()
    windowFixture.loadURL.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const opening = controller.open('preview-1', target, 'Example')
    const failedOpening = expect(opening).rejects.toThrow(
      'Picture-in-picture viewer did not load before the timeout.',
    )

    await vi.advanceTimersByTimeAsync(3_100)

    await failedOpening
    expect(controller.isOpen('preview-1')).toBe(false)
    expect(windowFixture.showInactive).not.toHaveBeenCalled()
  })

  it('releases a hidden window when first-frame delivery stalls', async () => {
    vi.useFakeTimers()
    const { source } = makeImage()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(async () => source),
      isDestroyed: () => false,
    })
    const { controller, windowFixture } = makeController()
    windowFixture.executeJavaScript.mockImplementationOnce(
      () => new Promise<unknown>(() => undefined),
    )
    const opening = controller.open('preview-1', target, 'Example')
    const failedOpening = expect(opening).rejects.toThrow(
      'Picture-in-picture frame delivery did not finish before the timeout.',
    )

    await vi.advanceTimersByTimeAsync(1_100)

    await failedOpening
    expect(controller.isOpen('preview-1')).toBe(false)
    expect(windowFixture.showInactive).not.toHaveBeenCalled()
  })

  it('releases the session and reports a native user close once', async () => {
    const { source } = makeImage()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(async () => source),
      isDestroyed: () => false,
    })
    const { controller, onClosed, windowFixture } = makeController()
    await controller.open('preview-1', target, 'Example')

    windowFixture.closeEvent()

    expect(controller.isOpen('preview-1')).toBe(false)
    expect(onClosed).toHaveBeenCalledExactlyOnceWith('preview-1')
  })

  it('falls back to destroying a window when native close throws', async () => {
    const { source } = makeImage()
    const target = fromPartial<WebContents>({
      capturePage: vi.fn(async () => source),
      isDestroyed: () => false,
    })
    const { controller, onClosed, windowFixture } = makeController()
    await controller.open('preview-1', target, 'Example')
    vi.mocked(windowFixture.window.close).mockImplementationOnce(() => {
      throw new Error('native close failed')
    })

    expect(() => controller.close('preview-1')).not.toThrow()

    expect(windowFixture.window.destroy).toHaveBeenCalledOnce()
    expect(controller.isOpen('preview-1')).toBe(false)
    expect(onClosed).toHaveBeenCalledExactlyOnceWith('preview-1')
  })

  it('fails explicitly in automation without constructing or revealing a native window', async () => {
    const target = fromPartial<WebContents>({ isDestroyed: () => false })
    const { constructorOptions, controller, windowFixture } = makeController({ automation: true })

    await expect(controller.open('preview-1', target, 'Example')).rejects.toMatchObject({
      code: 'BROWSER_PREVIEW_PICTURE_IN_PICTURE_UNAVAILABLE',
      reason: 'automation',
    })
    expect(constructorOptions).toHaveLength(0)
    expect(windowFixture.showInactive).not.toHaveBeenCalled()
  })
})

describe('browser preview picture-in-picture utilities', () => {
  it('uses a scriptless, network-denying data document', () => {
    const decoded = decodeURIComponent(buildBrowserPreviewPictureInPictureUrl())

    expect(decoded).toContain("default-src 'none'")
    expect(decoded).not.toContain('<script')
  })

  it('preserves area while fitting a new aspect ratio', () => {
    expect(fitBrowserPreviewPictureInPictureSize([480, 320], 16 / 9)).toEqual([523, 294])
  })
})
