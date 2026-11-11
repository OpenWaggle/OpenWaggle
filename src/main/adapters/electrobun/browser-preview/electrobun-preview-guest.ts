import type { BrowserPreviewAppearance } from '@shared/types/browser-preview-controls'
import { CdpConnection, type CdpSocketFactory } from './cdp-connection'
import { type CefDevToolsEndpoint, cefDevToolsSocketUrl } from './cef-devtools-endpoint'
import {
  browserPreviewColorSchemeFeatures,
  type CdpDeviceMetrics,
} from './electrobun-preview-device-metrics'
import { cdpPageEventHandlers } from './electrobun-preview-cdp-events'
import {
  browserPreviewHistoryFlags,
  browserPreviewHistoryTitle,
  decode,
  type ElectrobunPreviewGuestEvent,
  FrameTreeSchema,
  HistorySchema,
  NavigateResultSchema,
  ScreenshotSchema,
  ScriptIdentifierSchema,
} from './electrobun-preview-cdp-protocol'
import {
  BROWSER_PREVIEW_HOST_BINDING,
  BROWSER_PREVIEW_WORLD_NAME,
  type BrowserPreviewPageConfig,
  browserPreviewPageConfigureScript,
  browserPreviewPageScript,
} from './electrobun-preview-page-script'
import { createLogger } from '../../../logger'

const logger = createLogger('electrobun-browser-preview')

const TARGET_DEADLINE_MS = 15_000
const TARGET_POLL_MS = 100
const COMMAND_TIMEOUT_MS = 15_000

/** The native view behind a preview: an Electrobun `BrowserView` has this shape. */
export interface ElectrobunPreviewView {
  readonly id: number
  loadURL(url: string): void
  remove(): void
  openDevTools(): void
}

export interface ElectrobunPreviewGuestOptions {
  readonly view: ElectrobunPreviewView
  readonly marker: string
  /** `null` when the app has no CEF DevTools port. */
  readonly endpoint: CefDevToolsEndpoint | null
  readonly openSocket: CdpSocketFactory
  readonly onEvent: (event: ElectrobunPreviewGuestEvent) => void
}

/**
 * One CEF preview page driven over CDP: the page target found by the marker in its first URL, an
 * isolated-world page script, navigation, history, emulation and screenshots. Without CDP the
 * page still loads through the view, and the CDP features fail with a clear error.
 */
export class ElectrobunPreviewGuest {
  private connection: CdpConnection | null = null
  private attached: Promise<CdpConnection> | null = null
  private mainFrameId: string | null = null
  private pageScriptId: string | null = null
  /** The page script's isolated worlds, one per frame, by execution context id. */
  private readonly pageWorlds = new Set<number>()
  private readonly abort = new AbortController()
  private readonly cdpListeners = new Set<(method: string, params: unknown) => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  private readonly handlers: ReadonlyMap<string, (params: unknown) => void>
  private readonly options: ElectrobunPreviewGuestOptions

  constructor(options: ElectrobunPreviewGuestOptions) {
    this.options = options
    this.handlers = cdpPageEventHandlers({
      marker: options.marker,
      emit: options.onEvent,
      isMainFrame: (frameId) => this.mainFrameId === null || frameId === this.mainFrameId,
      setMainFrame: (frameId) => {
        this.mainFrameId = frameId
      },
      refreshHistory: () => this.refreshHistory(),
      dismissDialog: () => {
        void this.connection
          ?.send('Page.handleJavaScriptDialog', { accept: false })
          .catch(() => undefined)
      },
      pageWorlds: this.pageWorlds,
    })
  }

  /** Finds the page on the DevTools endpoint, prepares it, then loads `url`. */
  start(url: string, config: BrowserPreviewPageConfig): Promise<void> {
    this.attached = this.attach(config)
    return this.attached.then(
      () => this.navigate(url),
      (error: unknown) => {
        if (this.closed) return
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn('Browser preview runs without CDP', { reason })
        this.options.onEvent({ kind: 'detached', reason })
        this.options.view.loadURL(url)
      },
    )
  }

  async navigate(url: string): Promise<void> {
    const cdp = await this.cdpOrNull()
    if (cdp === null) {
      this.options.view.loadURL(url)
      return
    }
    const result = decode(NavigateResultSchema, await cdp.send('Page.navigate', { url }))
    if (result?.errorText && result.errorText !== 'net::ERR_ABORTED') {
      this.options.onEvent({
        kind: 'failed',
        code: 'LOAD_FAILED',
        description: result.errorText,
        url,
      })
    }
  }

  async goBack(): Promise<void> {
    await this.goInHistory(-1)
  }

  async goForward(): Promise<void> {
    await this.goInHistory(1)
  }

  async reload(ignoreCache: boolean): Promise<void> {
    await (await this.cdp()).send('Page.reload', { ignoreCache })
  }

  async stop(): Promise<void> {
    await (await this.cdp()).send('Page.stopLoading')
  }

  async emulate(metrics: CdpDeviceMetrics | null, appearance: BrowserPreviewAppearance) {
    const cdp = await this.cdp()
    await (metrics === null
      ? cdp.send('Emulation.clearDeviceMetricsOverride')
      : cdp.send('Emulation.setDeviceMetricsOverride', metrics))
    await cdp.send('Emulation.setEmulatedMedia', {
      features: browserPreviewColorSchemeFeatures(appearance),
    })
  }

  /** Updates the page script's chords and muting, now and for later documents. */
  async configurePage(config: BrowserPreviewPageConfig): Promise<void> {
    const cdp = await this.cdpOrNull()
    if (cdp === null) return
    await this.installPageScript(cdp, config)
    const expression = browserPreviewPageConfigureScript(config)
    await Promise.all(
      [...this.pageWorlds].map((contextId) =>
        cdp.send('Runtime.evaluate', { expression, contextId }).catch(() => undefined),
      ),
    )
  }

  /** The visible page as PNG bytes. */
  async captureScreenshot(): Promise<Uint8Array> {
    const shot = decode(
      ScreenshotSchema,
      await (await this.cdp()).send('Page.captureScreenshot', { format: 'png' }),
    )
    if (shot === null) throw new Error('The browser preview screenshot is malformed.')
    return Buffer.from(shot.data, 'base64')
  }

  /** One raw CDP command on this page. */
  async send(method: string, params: object = {}): Promise<unknown> {
    return (await this.cdp()).send(method, params)
  }

  /** Every CDP event of this page, as the agent's automation records them; returns the unsubscribe. */
  onCdpEvent(listener: (method: string, params: unknown) => void): () => void {
    this.cdpListeners.add(listener)
    return () => this.cdpListeners.delete(listener)
  }

  /** Called when the page's CDP connection ends; returns the unsubscribe. */
  onCdpClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /** Attaches CDP without loading a page, for profile maintenance. */
  attachOnly(config: BrowserPreviewPageConfig): Promise<void> {
    this.attached ??= this.attach(config)
    return this.attached.then(() => undefined)
  }

  openDevTools(): void {
    this.options.view.openDevTools()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.connection?.close()
    this.options.view.remove()
  }

  private async attach(config: BrowserPreviewPageConfig): Promise<CdpConnection> {
    const { endpoint } = this.options
    if (endpoint === null) throw new Error('This app has no CEF DevTools port configured.')
    const target = await endpoint.waitForPage(this.options.marker, {
      deadlineMs: TARGET_DEADLINE_MS,
      pollMs: TARGET_POLL_MS,
      signal: this.abort.signal,
    })
    const cdp = await CdpConnection.connect(cefDevToolsSocketUrl(endpoint.port, target), {
      openSocket: this.options.openSocket,
      commandTimeoutMs: COMMAND_TIMEOUT_MS,
    })
    if (this.closed) {
      cdp.close()
      throw new Error('The browser preview closed before CDP attached.')
    }
    this.connection = cdp
    cdp.onEvent((method, params) => {
      this.handlers.get(method)?.(params)
      for (const listener of this.cdpListeners) listener(method, params)
    })
    cdp.onClose(() => {
      for (const listener of this.closeListeners) listener()
      if (!this.closed) this.options.onEvent({ kind: 'detached', reason: 'CDP connection lost' })
    })
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')])
    await cdp.send('Runtime.addBinding', {
      name: BROWSER_PREVIEW_HOST_BINDING,
      executionContextName: BROWSER_PREVIEW_WORLD_NAME,
    })
    await this.installPageScript(cdp, config)
    const tree = decode(FrameTreeSchema, await cdp.send('Page.getFrameTree'))
    this.mainFrameId = tree?.frameTree.frame.id ?? null
    return cdp
  }

  private async installPageScript(cdp: CdpConnection, config: BrowserPreviewPageConfig) {
    if (this.pageScriptId !== null) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.pageScriptId })
    }
    const added = decode(
      ScriptIdentifierSchema,
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: browserPreviewPageScript(config),
        worldName: BROWSER_PREVIEW_WORLD_NAME,
      }),
    )
    this.pageScriptId = added?.identifier ?? null
  }

  private async cdpOrNull(): Promise<CdpConnection | null> {
    if (this.attached === null) return null
    try {
      const cdp = await this.attached
      return cdp.isOpen ? cdp : null
    } catch {
      return null
    }
  }

  private async cdp(): Promise<CdpConnection> {
    const cdp = await this.cdpOrNull()
    if (cdp === null) {
      throw new Error('This browser preview has no DevTools connection (CEF remote debugging).')
    }
    return cdp
  }

  private async goInHistory(step: -1 | 1) {
    const cdp = await this.cdp()
    const history = decode(HistorySchema, await cdp.send('Page.getNavigationHistory'))
    const entry = history?.entries[history.currentIndex + step]
    if (entry === undefined || entry.url.includes(this.options.marker)) return
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  private refreshHistory() {
    void (async () => {
      const cdp = await this.cdpOrNull()
      if (cdp === null) return
      const history = decode(HistorySchema, await cdp.send('Page.getNavigationHistory'))
      if (history === null) return
      const { marker, onEvent } = this.options
      onEvent({ kind: 'history', ...browserPreviewHistoryFlags(history, marker) })
      const title = browserPreviewHistoryTitle(history, marker)
      if (title !== null) onEvent({ kind: 'title', title })
    })().catch(() => undefined)
  }
}
