import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewAppearance,
  BrowserPreviewControlState,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewScreenshotArtifact,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import { getBrowserPreviewArtifactStore } from './browser-preview-artifacts'
import { browserPreviewAutomationPage } from './browser-preview-automation-page'
import { BrowserPreviewControlOperations } from './browser-preview-control-operations'
import { browserPreviewElementPicker } from './browser-preview-element-picker'
import { BrowserPreviewPictureInPictureController } from './browser-preview-picture-in-picture'
import { BrowserPreviewRecordingGrantController } from './browser-preview-recording-grant'
import { browserPreviewRecordingRequestBroker } from './browser-preview-recording-request-broker'
import type { BrowserPreviewRecord } from './browser-preview-records'

interface BrowserPreviewControlHost {
  readonly isLive: (record: BrowserPreviewRecord) => boolean
  readonly update: (
    record: BrowserPreviewRecord,
    controls: BrowserPreviewControlState,
  ) => BrowserPreviewState
}

const VIEWPORT_SCALE_PRECISION = 6

function attemptControlCleanup(action: () => void) {
  try {
    action()
  } catch {
    // A failed native cleanup must not prevent the remaining preview resources from releasing.
  }
}

function renderedViewportScale(record: BrowserPreviewRecord) {
  const viewport = presentationViewport(record)
  if (viewport.mode === 'fill') return record.state.controls.zoomFactor
  const bounds = record.bounds
  if (bounds === null) return record.state.controls.zoomFactor
  return Math.min(bounds.width / viewport.width, bounds.height / viewport.height)
}

function presentationViewport(record: BrowserPreviewRecord) {
  const viewport = record.state.controls.viewport
  const source = record.bounds?.sourceViewport
  return viewport.mode === 'fill' && source !== undefined
    ? { mode: 'fixed' as const, ...source }
    : viewport
}

export class BrowserPreviewControlCoordinator {
  private readonly controls = new BrowserPreviewControlOperations()
  private readonly recording = new BrowserPreviewRecordingGrantController()
  private readonly records = new Map<string, BrowserPreviewRecord>()
  private readonly emulationSignature = new WeakMap<
    BrowserPreviewRecord['view']['webContents'],
    string
  >()
  private readonly pictureInPicture: BrowserPreviewPictureInPictureController

  constructor(private readonly host: BrowserPreviewControlHost) {
    this.pictureInPicture = new BrowserPreviewPictureInPictureController({
      onClosed: (controlKey) => this.handlePictureInPictureClosed(controlKey),
    })
  }

  register(record: BrowserPreviewRecord): void {
    const controlKey = browserPreviewAutomationPage(record).tabId
    this.records.set(controlKey, record)
    void this.controls
      .register(controlKey, record.view.webContents, record.state.controls.appearance)
      .catch(() => undefined)
  }

  dispose(record: BrowserPreviewRecord): void {
    const controlKey = browserPreviewAutomationPage(record).tabId
    if (this.records.get(controlKey) === record) this.records.delete(controlKey)
    attemptControlCleanup(() => this.controls.dispose(controlKey))
    attemptControlCleanup(() => this.recording.finish(record.previewId, record.owner.sender))
    attemptControlCleanup(() => browserPreviewRecordingRequestBroker.dispose(record))
    void browserPreviewElementPicker.cancel(controlKey).catch(() => undefined)
    attemptControlCleanup(() => this.pictureInPicture.close(controlKey))
    this.emulationSignature.delete(record.view.webContents)
  }

  applyViewport(record: BrowserPreviewRecord): void {
    const contents = record.view.webContents
    if (contents.isDestroyed()) return
    const viewport = presentationViewport(record)
    if (viewport.mode === 'fill') {
      if (this.emulationSignature.has(contents)) contents.disableDeviceEmulation()
      this.emulationSignature.delete(contents)
      return
    }
    const zoomFactor = record.state.controls.zoomFactor
    const renderedWidth = Math.max(1, Math.round(viewport.width * zoomFactor))
    const renderedHeight = Math.max(1, Math.round(viewport.height * zoomFactor))
    const bounds = record.bounds
    const scale =
      bounds === null
        ? 1
        : Math.min(1, bounds.width / renderedWidth, bounds.height / renderedHeight)
    const signature = [renderedWidth, renderedHeight, scale.toFixed(VIEWPORT_SCALE_PRECISION)].join(
      ':',
    )
    if (this.emulationSignature.get(contents) === signature) return
    contents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: renderedWidth, height: renderedHeight },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: { width: renderedWidth, height: renderedHeight },
      scale,
    })
    this.emulationSignature.set(contents, signature)
  }

  setViewport(record: BrowserPreviewRecord, viewport: BrowserPreviewViewport): BrowserPreviewState {
    const state = this.update(record, { viewport })
    this.applyViewport(record)
    return state
  }

  setZoomFactor(record: BrowserPreviewRecord, zoomFactor: number): BrowserPreviewState {
    const state = this.update(record, { zoomFactor })
    this.applyViewport(record)
    return state
  }

  async setAppearance(
    record: BrowserPreviewRecord,
    appearance: BrowserPreviewAppearance,
  ): Promise<BrowserPreviewState> {
    await this.controls.setAppearance(
      browserPreviewAutomationPage(record).tabId,
      record.view.webContents,
      appearance,
    )
    return this.update(record, { appearance })
  }

  hardReload(record: BrowserPreviewRecord): void {
    this.controls.hardReload(record.view.webContents)
  }

  openDevTools(record: BrowserPreviewRecord): Promise<void> {
    return this.controls.openDevTools(
      browserPreviewAutomationPage(record).tabId,
      record.view.webContents,
    )
  }

  clearCookies(record: BrowserPreviewRecord): Promise<void> {
    return this.controls.clearCookies(record.view.webContents)
  }

  clearCache(record: BrowserPreviewRecord): Promise<void> {
    return this.controls.clearCache(record.view.webContents)
  }

  captureScreenshot(record: BrowserPreviewRecord): Promise<BrowserPreviewScreenshotArtifact> {
    return getBrowserPreviewArtifactStore().captureScreenshot(
      record.previewId,
      record.view.webContents,
    )
  }

  revealArtifact(artifactPath: string): Promise<void> {
    return getBrowserPreviewArtifactStore().revealArtifact(artifactPath)
  }

  copyScreenshot(artifactPath: string): Promise<void> {
    return getBrowserPreviewArtifactStore().copyScreenshot(artifactPath)
  }

  startRecording(record: BrowserPreviewRecord): BrowserPreviewRecordingGrant {
    const grant = this.recording.begin(
      record.previewId,
      record.owner.sender,
      record.view.webContents,
    )
    this.update(record, { recording: true })
    return grant
  }

  async saveRecording(
    record: BrowserPreviewRecord,
    input: BrowserPreviewRecordingSaveInput,
  ): Promise<BrowserPreviewRecordingArtifact> {
    if (!record.state.controls.recording) {
      throw new Error('This browser preview does not own an active recording grant.')
    }
    return getBrowserPreviewArtifactStore().saveRecording(input)
  }

  stopRecording(record: BrowserPreviewRecord): void {
    this.recording.finish(record.previewId, record.owner.sender)
    this.update(record, { recording: false })
  }

  async pickElement(record: BrowserPreviewRecord): Promise<BrowserPreviewAnnotation | null> {
    const controlKey = browserPreviewAutomationPage(record).tabId
    this.update(record, { picking: true })
    try {
      const annotation = await browserPreviewElementPicker.pick(
        controlKey,
        record.previewId,
        record.view.webContents,
        renderedViewportScale(record),
      )
      return this.host.isLive(record) ? annotation : null
    } finally {
      if (this.host.isLive(record)) this.update(record, { picking: false })
    }
  }

  async cancelPickElement(record: BrowserPreviewRecord): Promise<void> {
    await browserPreviewElementPicker.cancel(browserPreviewAutomationPage(record).tabId)
    this.update(record, { picking: false })
  }

  async openPictureInPicture(record: BrowserPreviewRecord): Promise<BrowserPreviewState> {
    await this.pictureInPicture.open(
      browserPreviewAutomationPage(record).tabId,
      record.view.webContents,
      record.state.title,
    )
    return this.update(record, { pictureInPicture: true })
  }

  closePictureInPicture(record: BrowserPreviewRecord): BrowserPreviewState {
    this.pictureInPicture.close(browserPreviewAutomationPage(record).tabId)
    if (!record.state.controls.pictureInPicture) return record.state
    return this.update(record, { pictureInPicture: false })
  }

  private update(
    record: BrowserPreviewRecord,
    patch: Partial<BrowserPreviewControlState>,
  ): BrowserPreviewState {
    return this.host.update(record, { ...record.state.controls, ...patch })
  }

  private handlePictureInPictureClosed(controlKey: string): void {
    const record = this.records.get(controlKey)
    if (!record || !this.host.isLive(record) || !record.state.controls.pictureInPicture) return
    this.update(record, { pictureInPicture: false })
  }
}
