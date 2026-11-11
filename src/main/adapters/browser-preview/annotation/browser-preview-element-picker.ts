import { randomUUID } from 'node:crypto'
import { safeDecodeUnknown } from '@shared/schema'
import { browserPreviewElementPickPayloadSchema } from '@shared/schemas/browser-preview-controls'
import type { PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import {
  BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT,
} from './browser-preview-element-picker-script'

/** A region of the preview's viewport, in the units the page's screenshots take. */
export interface BrowserPreviewPickerClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The page an element picker runs on, as one desktop shell reaches it. */
export interface BrowserPreviewPickerPage {
  /** Throws when the page's owner retired it. */
  readonly assertAvailable: () => void
  /** Whether the page is gone, so no script can run on it. */
  readonly isDestroyed: () => boolean
  /** Runs the picker in a world the page cannot reach; resolves with its raw result. */
  readonly runPicker: (script: string) => Promise<unknown>
  /** Runs a short control script in the picker's world. */
  readonly runControl: (script: string) => Promise<unknown>
  /** A screenshot of `clip` of the page's viewport, stored as an artifact. */
  readonly captureScreenshot: (
    clip: BrowserPreviewPickerClip,
  ) => Promise<BrowserPreviewScreenshotArtifact>
}

export type PrepareBrowserPreviewAnnotationAttachment = (
  payload: BrowserPreviewElementPickPayload,
  screenshot: BrowserPreviewScreenshotArtifact,
) => Promise<PreparedAttachment | null>

interface ActivePick {
  readonly token: string
  readonly page: BrowserPreviewPickerPage
  readonly cancel: () => void
}

const PICKER_CONTROL_TIMEOUT_MS = 1_000

async function executePickerControl(page: BrowserPreviewPickerPage, code: string): Promise<void> {
  if (page.isDestroyed()) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, PICKER_CONTROL_TIMEOUT_MS)
    void page.runControl(code).then(finish, finish)
  })
}

function captureClip(payload: BrowserPreviewElementPickPayload, scale: number) {
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

/** The picker's result is page-derived: it is decoded before anything reads it. */
function decodePickPayload(value: unknown): BrowserPreviewElementPickPayload | null {
  if (value === null) return null
  const decoded = safeDecodeUnknown(browserPreviewElementPickPayloadSchema, value)
  if (decoded.success) return decoded.data
  throw new Error(
    `Browser preview element picker returned invalid data: ${decoded.issues.join('; ')}`,
  )
}

/** Waits for `work`, then for `release` whether `work` succeeded or not. */
async function settledBefore<T>(work: Promise<T>, release: () => Promise<void>): Promise<T> {
  try {
    return await work
  } finally {
    await release()
  }
}

/**
 * The element picker and annotation editor of a Browser preview: one active pick per key, a
 * screenshot of the annotated region, and the composer attachment made from both.
 */
export class BrowserPreviewElementPicker {
  private readonly active = new Map<string, ActivePick>()
  private readonly prepareAttachment: PrepareBrowserPreviewAnnotationAttachment

  constructor(prepareAttachment: PrepareBrowserPreviewAnnotationAttachment) {
    this.prepareAttachment = prepareAttachment
  }

  /**
   * Lets the user pick elements and annotate the page; `null` when they cancel. `captureScale`
   * maps the page's CSS pixels to the units of `page.captureScreenshot`.
   */
  async pick(
    pickKey: string,
    previewId: string,
    page: BrowserPreviewPickerPage,
    captureScale = 1,
  ): Promise<BrowserPreviewAnnotation | null> {
    page.assertAvailable()
    if (page.isDestroyed()) throw new Error('Browser preview content is no longer available.')
    if (this.active.has(pickKey)) await this.cancel(pickKey)
    page.assertAvailable()
    const token = randomUUID()
    let signalCancellation: () => void = () => undefined
    const cancelled = new Promise<null>((resolve) => {
      signalCancellation = () => resolve(null)
    })
    this.active.set(pickKey, { token, page, cancel: signalCancellation })
    let overlayReleased = false
    const releaseOverlay = async () => {
      if (overlayReleased || page.isDestroyed()) return
      overlayReleased = true
      await executePickerControl(page, BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT)
    }

    try {
      const raw: unknown = await Promise.race([
        page.runPicker(BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT),
        cancelled,
      ])
      if (this.active.get(pickKey)?.token !== token) return null
      const payload = decodePickPayload(raw)
      if (payload === null) return null
      const screenshot = await settledBefore(
        page.captureScreenshot(captureClip(payload, captureScale)),
        releaseOverlay,
      )
      page.assertAvailable()
      if (this.active.get(pickKey)?.token !== token) return null
      const attachment = await this.prepareAttachment(payload, screenshot)
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
    await executePickerControl(active.page, BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT)
  }
}
