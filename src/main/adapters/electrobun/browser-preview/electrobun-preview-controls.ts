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
import type { ElectrobunPreviewRecord } from './electrobun-preview-records'
import { emitBrowserPreviewState } from '../../browser-preview/browser-preview-owner-events'
import { browserPreviewStateError } from '../../browser-preview/browser-preview-page-state'
import { nextBrowserPreviewZoomFactor } from '../../browser-preview/browser-preview-zoom'
import { AutomationDesktopUiError, isAutomationMode } from '../../../desktop-automation-policy'

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const PNG_SIGNATURE_BYTES = PNG_SIGNATURE.byteLength
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20
const PNG_HEADER_BYTES = 24
const HIDDEN_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const

/** Width and height from a PNG's IHDR chunk. */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  if (
    png.byteLength < PNG_HEADER_BYTES ||
    PNG_SIGNATURE.some((byte, index) => png[index] !== byte)
  ) {
    throw new Error('The browser preview screenshot is not a PNG image.')
  }
  const view = new DataView(png.buffer, png.byteOffset + PNG_SIGNATURE_BYTES)
  return {
    width: view.getUint32(PNG_WIDTH_OFFSET - PNG_SIGNATURE_BYTES),
    height: view.getUint32(PNG_HEIGHT_OFFSET - PNG_SIGNATURE_BYTES),
  }
}

/**
 * A CEF preview's native frame and its controls: placement, emulation (zoom, viewport,
 * appearance), the page script's chords and muting, screenshots, cookies and DevTools.
 */
export class ElectrobunPreviewControls {
  private readonly host: ElectrobunPreviewHost

  constructor(host: ElectrobunPreviewHost) {
    this.host = host
  }

  update(
    record: ElectrobunPreviewRecord,
    patch: Partial<BrowserPreviewState>,
  ): BrowserPreviewState {
    record.state = { ...record.state, ...patch }
    emitBrowserPreviewState(record)
    return record.state
  }

  updateControls(record: ElectrobunPreviewRecord, patch: Partial<BrowserPreviewControlState>) {
    return this.update(record, { controls: { ...record.state.controls, ...patch } })
  }

  fail(record: ElectrobunPreviewRecord, error: unknown): void {
    if (record.disposed) return
    const description = error instanceof Error ? error.message : String(error)
    this.update(record, {
      loading: false,
      error: browserPreviewStateError('PREVIEW_FAILED', description, record.state.url),
    })
  }

  /** Shows the view at `bounds` in its owner's window, or hides it for `null`. */
  place(record: ElectrobunPreviewRecord, bounds: BrowserPreviewBounds | null): void {
    record.bounds = bounds
    if (bounds === null) {
      this.host.frames.setHidden(record.webviewId, true)
      return
    }
    this.host.frames.setFrame(record.webviewId, bounds.width > 0 ? bounds : HIDDEN_FRAME)
    this.host.frames.setHidden(record.webviewId, false)
    this.applyEmulationSoon(record)
  }

  pageConfig(record: ElectrobunPreviewRecord): BrowserPreviewPageConfig {
    return {
      chords: browserPreviewPageChords(record.owner.shortcutBindings, this.host.isMac),
      muted: record.state.audioMuted,
      isMac: this.host.isMac,
    }
  }

  configurePage(record: ElectrobunPreviewRecord): void {
    void record.guest.configurePage(this.pageConfig(record)).catch((error: unknown) => {
      this.fail(record, error)
    })
  }

  async applyEmulation(record: ElectrobunPreviewRecord): Promise<void> {
    if (record.disposed) return
    const { viewport, zoomFactor, appearance } = record.state.controls
    await record.guest.emulate(
      browserPreviewDeviceMetrics(viewport, zoomFactor, record.bounds),
      appearance,
    )
  }

  /** Applies emulation without waiting; a preview without CDP keeps its page as is. */
  applyEmulationSoon(record: ElectrobunPreviewRecord): void {
    void this.applyEmulation(record).catch(() => undefined)
  }

  zoom(record: ElectrobunPreviewRecord, action: BrowserPreviewZoomAction): number {
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

  setAudioMuted(record: ElectrobunPreviewRecord, audioMuted: boolean): BrowserPreviewState {
    if (record.state.audioMuted === audioMuted) return record.state
    const state = this.update(record, { audioMuted })
    this.configurePage(record)
    return state
  }

  openDevTools(record: ElectrobunPreviewRecord): Promise<void> {
    // CEF opens DevTools in a window of its own.
    if (isAutomationMode()) {
      return Promise.reject(new AutomationDesktopUiError('browser-preview.devtools'))
    }
    record.guest.openDevTools()
    return Promise.resolve()
  }

  async clearCookies(record: ElectrobunPreviewRecord): Promise<void> {
    await record.guest.send('Network.clearBrowserCookies')
  }

  async clearCache(record: ElectrobunPreviewRecord): Promise<void> {
    await record.guest.send('Network.clearBrowserCache')
  }

  async captureScreenshot(
    record: ElectrobunPreviewRecord,
  ): Promise<BrowserPreviewScreenshotArtifact> {
    const data = await record.guest.captureScreenshot()
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
    }
  }

  async revealArtifact(artifactPath: string): Promise<void> {
    this.host.revealInFolder(await this.host.artifacts().resolveOwnedArtifact(artifactPath))
  }

  async copyScreenshot(artifactPath: string, readFile: (path: string) => Promise<Uint8Array>) {
    const resolved = await this.host.artifacts().resolveOwnedArtifact(artifactPath)
    await this.host.writeClipboardImage(await readFile(resolved))
  }
}
