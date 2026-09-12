import { randomUUID } from 'node:crypto'
import { safeDecodeUnknown } from '@shared/schema'
import { browserPreviewElementPickPayloadSchema } from '@shared/schemas/browser-preview-controls'
import type { PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import type { Rectangle, WebContents } from 'electron'
import { getBrowserPreviewArtifactStore } from './browser-preview-artifacts'
import {
  BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
} from './browser-preview-element-picker-script'

interface ActivePick {
  readonly token: string
  readonly contents: WebContents
  readonly cancel: () => void
}

interface ElementPickerArtifactStore {
  captureScreenshot(
    previewId: string,
    contents: WebContents,
    clip?: Rectangle,
  ): Promise<BrowserPreviewScreenshotArtifact>
  prepareAnnotationAttachment(
    payload: BrowserPreviewElementPickPayload,
    screenshot: BrowserPreviewScreenshotArtifact,
  ): Promise<PreparedAttachment | null>
}

const PICKER_CONTROL_TIMEOUT_MS = 1_000

async function executePickerControl(contents: WebContents, code: string): Promise<void> {
  if (contents.isDestroyed()) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, PICKER_CONTROL_TIMEOUT_MS)
    void contents
      .executeJavaScriptInIsolatedWorld(BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID, [{ code }], true)
      .then(finish, finish)
  })
}

function captureClip(payload: BrowserPreviewElementPickPayload, scale: number): Rectangle {
  const rect = payload.captureRect
  const boundedScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const x = Math.floor(rect.x * boundedScale)
  const y = Math.floor(rect.y * boundedScale)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil((rect.x + rect.width) * boundedScale) - x),
    height: Math.max(1, Math.ceil((rect.y + rect.height) * boundedScale) - y),
  }
}

function decodePickPayload(value: unknown): BrowserPreviewElementPickPayload | null {
  if (value === null) return null
  const decoded = safeDecodeUnknown(browserPreviewElementPickPayloadSchema, value)
  if (decoded.success) return decoded.data
  throw new Error(
    `Browser preview element picker returned invalid data: ${decoded.issues.join('; ')}`,
  )
}

export class BrowserPreviewElementPicker {
  private readonly active = new Map<string, ActivePick>()

  constructor(private artifacts: ElementPickerArtifactStore | null = null) {}

  async pick(
    pickKey: string,
    previewId: string,
    contents: WebContents,
    captureScale = 1,
  ): Promise<BrowserPreviewAnnotation | null> {
    if (contents.isDestroyed()) throw new Error('Browser preview content is no longer available.')
    if (this.active.has(pickKey)) await this.cancel(pickKey)
    const token = randomUUID()
    let signalCancellation: () => void = () => undefined
    const cancelled = new Promise<null>((resolve) => {
      signalCancellation = () => resolve(null)
    })
    this.active.set(pickKey, { token, contents, cancel: signalCancellation })
    let overlayReleased = false
    const releaseOverlay = async () => {
      if (overlayReleased || contents.isDestroyed()) return
      overlayReleased = true
      await executePickerControl(contents, BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT)
    }

    try {
      const raw: unknown = await Promise.race([
        contents.executeJavaScriptInIsolatedWorld(
          BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
          [{ code: BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT }],
          true,
        ),
        cancelled,
      ])
      if (this.active.get(pickKey)?.token !== token) return null
      const payload = decodePickPayload(raw)
      if (payload === null) return null
      const artifacts = this.getArtifacts()
      const screenshot = await artifacts
        .captureScreenshot(previewId, contents, captureClip(payload, captureScale))
        .finally(releaseOverlay)
      if (this.active.get(pickKey)?.token !== token) return null
      const attachment = await artifacts.prepareAnnotationAttachment(payload, screenshot)
      if (this.active.get(pickKey)?.token !== token) return null
      return {
        id: randomUUID(),
        previewId,
        pageUrl: payload.pageUrl,
        pageTitle: payload.pageTitle,
        comment: payload.comment,
        element: payload.elements[0]?.element ?? null,
        elements: payload.elements,
        regions: payload.regions,
        strokes: payload.strokes,
        styleChanges: payload.styleChanges,
        captureRect: payload.captureRect,
        createdAt: new Date().toISOString(),
        screenshot,
        attachment,
      }
    } finally {
      await releaseOverlay()
      if (this.active.get(pickKey)?.token === token) this.active.delete(pickKey)
    }
  }

  async cancel(pickKey: string): Promise<void> {
    const active = this.active.get(pickKey)
    if (active === undefined) return
    this.active.delete(pickKey)
    active.cancel()
    await executePickerControl(active.contents, BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT)
  }

  cancelForContents(contents: WebContents): void {
    for (const [previewId, active] of this.active) {
      if (active.contents !== contents) continue
      this.active.delete(previewId)
      active.cancel()
      void executePickerControl(contents, BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT)
    }
  }

  private getArtifacts(): ElementPickerArtifactStore {
    this.artifacts ??= getBrowserPreviewArtifactStore()
    return this.artifacts
  }
}

export const browserPreviewElementPicker = new BrowserPreviewElementPicker()
