import type {
  BrowserPreviewBounds,
  BrowserPreviewState,
  BrowserPreviewZoomAction,
} from '@shared/types/browser-preview'
import {
  BROWSER_PREVIEW_CAPTURE_LIMITS,
  type BrowserPreviewAppearance,
  type BrowserPreviewControlState,
  type BrowserPreviewScreenshotArtifact,
  type BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import { browserPreviewDeviceMetrics } from './electrobun-preview-device-metrics'
import {
  type BrowserPreviewPageConfig,
  browserPreviewPageChords,
} from './electrobun-preview-page-script'
import type { ElectrobunPreviewHost } from './electrobun-preview-record-factory'
import { type CefViewportRect, pngDimensions } from './electrobun-preview-screenshots'
import type { ElectrobunPreviewRecord } from './electrobun-preview-records'
import { emitBrowserPreviewState } from '../../browser-preview/browser-preview-owner-events'
import { browserPreviewStateError } from '../../browser-preview/browser-preview-page-state'
import { nextBrowserPreviewZoomFactor } from '../../browser-preview/browser-preview-zoom'
import { AutomationDesktopUiError, isAutomationMode } from '../../../desktop-automation-policy'

const HIDDEN_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const

/**
 * A CEF preview's native frame and its controls: placement, emulation (zoom, viewport,
 * appearance), the page script's chords and muting, screenshots, cookies and DevTools.
 */
export class ElectrobunPreviewControls {
  private readonly host: ElectrobunPreviewHost

  constructor(host: ElectrobunPreviewHost) {
    this.host = host
  }

  update(record: ElectrobunPreviewRecord, patch: Partial<BrowserPreviewState>) {
    record.state = { ...record.state, ...patch }
    emitBrowserPreviewState(record)
    return record.state
  }

  updateControls(record: ElectrobunPreviewRecord, patch: Partial<BrowserPreviewControlState>) {
    return this.update(record, { controls: { ...record.state.controls, ...patch } })
  }

  fail(record: ElectrobunPreviewRecord, error: unknown) {
    if (record.disposed) return
    const description = error instanceof Error ? error.message : String(error)
    this.update(record, {
      loading: false,
      error: browserPreviewStateError('PREVIEW_FAILED', description, record.state.url),
    })
  }

  /** Shows the view at `bounds` in its owner's window, or hides it for `null`. */
  place(record: ElectrobunPreviewRecord, bounds: BrowserPreviewBounds | null) {
    record.bounds = bounds
    if (bounds === null) {
      this.host.frames.setHidden(record.webviewId, true)
      return
    }
    this.host.frames.setFrame(record.webviewId, bounds.width > 0 ? bounds : HIDDEN_FRAME)
    this.host.frames.setHidden(record.webviewId, false)
    this.applyEmulationSoon(record)
  }

  pageConfig(record: ElectrobunPreviewRecord) {
    return {
      chords: browserPreviewPageChords(record.owner.shortcutBindings, this.host.isMac),
      muted: record.state.audioMuted,
      isMac: this.host.isMac,
    } satisfies BrowserPreviewPageConfig
  }

  configurePage(record: ElectrobunPreviewRecord) {
    void record.guest.configurePage(this.pageConfig(record)).catch((error: unknown) => {
      this.fail(record, error)
    })
  }

  async applyEmulation(record: ElectrobunPreviewRecord) {
    if (record.disposed) return
    const { viewport, zoomFactor, appearance } = record.state.controls
    await record.guest.emulate(
      browserPreviewDeviceMetrics(viewport, zoomFactor, record.bounds),
      appearance,
    )
  }

  /** Applies emulation without waiting; a preview without CDP keeps its page as is. */
  applyEmulationSoon(record: ElectrobunPreviewRecord) {
    void this.applyEmulation(record).catch(() => undefined)
  }

  zoom(record: ElectrobunPreviewRecord, action: BrowserPreviewZoomAction) {
    const next = nextBrowserPreviewZoomFactor(record.state.controls.zoomFactor, action)
    this.updateControls(record, { zoomFactor: next })
    this.applyEmulationSoon(record)
    return next
  }

  setViewport(record: ElectrobunPreviewRecord, viewport: BrowserPreviewViewport) {
    const state = this.updateControls(record, { viewport })
    this.applyEmulationSoon(record)
    return state
  }

  async setAppearance(record: ElectrobunPreviewRecord, appearance: BrowserPreviewAppearance) {
    const state = this.updateControls(record, { appearance })
    await this.applyEmulation(record)
    return state
  }

  setAudioMuted(record: ElectrobunPreviewRecord, audioMuted: boolean) {
    if (record.state.audioMuted === audioMuted) return record.state
    const state = this.update(record, { audioMuted })
    this.configurePage(record)
    return state
  }

  openDevTools(record: ElectrobunPreviewRecord) {
    // CEF opens DevTools in a window of its own.
    if (isAutomationMode()) {
      return Promise.reject(
        new AutomationDesktopUiError('browser-preview.devtools'),
      ) satisfies Promise<void>
    }
    record.guest.openDevTools()
    return Promise.resolve() satisfies Promise<void>
  }

  async clearCookies(record: ElectrobunPreviewRecord) {
    await record.guest.send('Network.clearBrowserCookies')
  }

  async clearCache(record: ElectrobunPreviewRecord) {
    await record.guest.send('Network.clearBrowserCache')
  }

  /** The visible page, or `rect` of its viewport, stored as a screenshot artifact. */
  async captureScreenshot(record: ElectrobunPreviewRecord, rect?: CefViewportRect) {
    const data = await record.guest.captureScreenshot(rect)
    if (data.byteLength > BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES) {
      throw new Error(
        `Browser preview screenshot exceeds ${String(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES)} bytes.`,
      )
    }
    const dimensions = pngDimensions(data)
    const stored = await this.host.artifacts().write('screenshot', 'png', data)
    return {
      ...stored,
      previewId: record.previewId,
      mimeType: 'image/png',
      sizeBytes: data.byteLength,
      ...dimensions,
      createdAt: new Date().toISOString(),
    } satisfies BrowserPreviewScreenshotArtifact
  }

  async revealArtifact(artifactPath: string) {
    this.host.revealInFolder(await this.host.artifacts().resolveOwnedArtifact(artifactPath))
  }

  async copyScreenshot(artifactPath: string, readFile: (path: string) => Promise<Uint8Array>) {
    const resolved = await this.host.artifacts().resolveOwnedArtifact(artifactPath)
    await this.host.writeClipboardImage(await readFile(resolved))
  }
}
