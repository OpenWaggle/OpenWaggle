import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Debugger, NativeImage, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'
import { captureBrowserPreviewAutomationSnapshot } from '../browser-preview-automation-snapshot'
import { BrowserPreviewCaptureTimeoutError } from '../browser-preview-capture'

interface ImageFixtureOptions {
  readonly width: number
  readonly height: number
  readonly data: Buffer
  readonly resized?: NativeImage
}

function imageFixture(options: ImageFixtureOptions) {
  return fromPartial<NativeImage>({
    getSize: () => ({ width: options.width, height: options.height }),
    resize: vi.fn(() => options.resized ?? imageFixture(options)),
    toPNG: vi.fn(() => options.data),
  })
}

function pageData() {
  return {
    url: 'http://localhost:3000/settings',
    title: 'Settings',
    loading: false,
    visibleText: 'Appearance Save',
    interactiveElements: [
      {
        tag: 'button',
        role: 'button',
        name: 'Save',
        selector: '#save',
        x: 20,
        y: 30,
        width: 80,
        height: 32,
      },
    ],
  }
}

function createPage(sourceImage: NativeImage, accessibility: unknown) {
  const contentsEvents = new EventEmitter()
  const debuggerEvents = new EventEmitter()
  let attached = false
  const sendCommand = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'Runtime.evaluate') return { result: { value: pageData() } }
    if (method === 'Accessibility.getFullAXTree') return accessibility
    return {}
  })
  const browserDebugger = fromPartial<Debugger>({
    on: debuggerEvents.on.bind(debuggerEvents),
    removeListener: debuggerEvents.removeListener.bind(debuggerEvents),
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: () => attached,
    sendCommand,
  })
  const contents = fromPartial<WebContents>({
    id: 1,
    capturePage: vi.fn(async () => sourceImage),
    debugger: browserDebugger,
    getBackgroundThrottling: () => true,
    isDevToolsOpened: () => false,
    isDestroyed: () => false,
    on: contentsEvents.on.bind(contentsEvents),
    once: contentsEvents.once.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    setBackgroundThrottling: vi.fn(),
  })
  return {
    contentsEvents,
    debuggerEvents,
    page: { tabId: 'tab-1', contents },
    sendCommand,
  }
}

describe('browser preview automation snapshot', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds image dimensions and preserves page, diagnostics, and capture metadata', async () => {
    const resized = imageFixture({ width: 1_024, height: 768, data: Buffer.from([1, 2, 3]) })
    const source = imageFixture({
      width: 3_200,
      height: 2_400,
      data: Buffer.from([9]),
      resized,
    })
    const nodes = Array.from({ length: 513 }, (_, index) => ({ nodeId: String(index) }))
    const { debuggerEvents, page } = createPage(source, { nodes })
    const controller = new BrowserPreviewAutomationController()
    await controller.run(page, 'seed-diagnostics', async (context) => {
      await context.send('Runtime.enable')
    })
    debuggerEvents.emit('message', {}, 'Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ value: 'preview ready' }],
      timestamp: 1_725_000_000,
    })
    debuggerEvents.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'request-1',
      request: { url: 'http://localhost:3000/api', method: 'GET' },
      timestamp: 1_725_000_000,
    })
    debuggerEvents.emit('message', {}, 'Network.responseReceived', {
      requestId: 'request-1',
      response: { url: 'http://localhost:3000/api', status: 200 },
      timestamp: 1_725_000_001,
    })

    const snapshot = await captureBrowserPreviewAutomationSnapshot(controller, page)

    expect(source.resize).toHaveBeenCalledOnce()
    expect(source.resize).toHaveBeenCalledWith({ width: 1_024, height: 768 })
    expect(source.toPNG).not.toHaveBeenCalled()
    expect(resized.toPNG).toHaveBeenCalledOnce()
    expect(snapshot).toMatchObject({
      url: 'http://localhost:3000/settings',
      title: 'Settings',
      loading: false,
      visibleText: 'Appearance Save',
      screenshot: {
        mimeType: 'image/png',
        data: Buffer.from([1, 2, 3]).toString('base64'),
        width: 1_024,
        height: 768,
      },
      consoleEntries: [expect.objectContaining({ level: 'log', text: 'preview ready' })],
      networkEntries: [expect.objectContaining({ status: 200, failed: false })],
    })
    expect(snapshot.accessibilityTree).toEqual({
      nodes: nodes.slice(0, 512),
      truncated: true,
    })
    expect(snapshot.actionTimeline).toEqual([
      expect.objectContaining({ action: 'seed-diagnostics', status: 'succeeded' }),
      expect.objectContaining({ action: 'snapshot', status: 'running' }),
    ])
  })

  it('rejects an oversized inline PNG after one bounded encode', async () => {
    const source = imageFixture({
      width: 800,
      height: 600,
      data: Buffer.alloc(4 * 1_024 * 1_024),
    })
    const { page } = createPage(source, { nodes: [] })

    await expect(
      captureBrowserPreviewAutomationSnapshot(new BrowserPreviewAutomationController(), page),
    ).rejects.toThrow('exceeded the inline image limit')
    expect(source.resize).not.toHaveBeenCalled()
    expect(source.toPNG).toHaveBeenCalledOnce()
  })

  it('retries transient compositor capture failures', async () => {
    vi.useFakeTimers()
    const source = imageFixture({ width: 800, height: 600, data: Buffer.from([1, 2, 3]) })
    const { page } = createPage(source, { nodes: [] })
    vi.mocked(page.contents.capturePage)
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockResolvedValue(source)

    const pending = captureBrowserPreviewAutomationSnapshot(
      new BrowserPreviewAutomationController(),
      page,
    )
    await vi.advanceTimersByTimeAsync(240)

    await expect(pending).resolves.toMatchObject({ url: 'http://localhost:3000/settings' })
    expect(page.contents.capturePage).toHaveBeenCalledTimes(3)
  })

  it('rejects a snapshot whose page changes before all evidence is captured', async () => {
    const source = imageFixture({ width: 800, height: 600, data: Buffer.from([1, 2, 3]) })
    const { contentsEvents, page, sendCommand } = createPage(source, { nodes: [] })
    let releaseCapture: (() => void) | undefined
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    vi.mocked(page.contents.capturePage).mockImplementation(async () => {
      await captureGate
      return source
    })

    const pending = captureBrowserPreviewAutomationSnapshot(
      new BrowserPreviewAutomationController(),
      page,
    )
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        'Accessibility.getFullAXTree',
        expect.objectContaining({ depth: 8 }),
      )
    })
    contentsEvents.emit('did-start-navigation', {}, 'https://example.com/replacement', false, true)
    releaseCapture?.()

    await expect(pending).rejects.toThrow('interrupted by page navigation')
  })

  it('cancels a stuck native capture without wedging the tab queue', async () => {
    const source = imageFixture({ width: 800, height: 600, data: Buffer.from([1, 2, 3]) })
    const { page, sendCommand } = createPage(source, { nodes: [] })
    const controller = new BrowserPreviewAutomationController()
    const cancellation = new AbortController()
    vi.mocked(page.contents.capturePage).mockImplementation(
      () => new Promise<NativeImage>(() => undefined),
    )
    const pending = captureBrowserPreviewAutomationSnapshot(controller, page, cancellation.signal)
    await vi.waitFor(() => expect(page.contents.capturePage).toHaveBeenCalledOnce())

    cancellation.abort()

    await expect(pending).rejects.toThrow('cancelled')
    const evaluationsBeforeRetry = sendCommand.mock.calls.filter(
      ([method]) => method === 'Runtime.evaluate',
    ).length
    const retryCancellation = new AbortController()
    const retry = captureBrowserPreviewAutomationSnapshot(
      controller,
      page,
      retryCancellation.signal,
    )
    await vi.waitFor(() =>
      expect(
        sendCommand.mock.calls.filter(([method]) => method === 'Runtime.evaluate').length,
      ).toBeGreaterThan(evaluationsBeforeRetry),
    )
    expect(page.contents.capturePage).toHaveBeenCalledOnce()
    retryCancellation.abort()
    await expect(retry).rejects.toThrow('cancelled')

    await expect(
      controller.run(page, 'next', (context) => context.send('Page.getFrameTree')),
    ).resolves.toEqual({})
  })

  it('bounds a permanently stalled capture and releases snapshot control', async () => {
    vi.useFakeTimers()
    const source = imageFixture({ width: 800, height: 600, data: Buffer.from([1, 2, 3]) })
    const { page } = createPage(source, { nodes: [] })
    const controller = new BrowserPreviewAutomationController()
    vi.mocked(page.contents.capturePage).mockImplementation(
      () => new Promise<NativeImage>(() => undefined),
    )
    const pending = captureBrowserPreviewAutomationSnapshot(controller, page)
    const result = expect(pending).rejects.toBeInstanceOf(BrowserPreviewCaptureTimeoutError)

    await vi.advanceTimersByTimeAsync(3_500)

    await result
    expect(page.contents.capturePage).toHaveBeenCalledOnce()
    await expect(
      controller.run(page, 'next', (context) => context.send('Page.getFrameTree')),
    ).resolves.toEqual({})
  })
})
