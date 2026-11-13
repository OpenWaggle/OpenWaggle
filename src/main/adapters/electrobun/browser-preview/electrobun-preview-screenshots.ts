import { Schema } from '@shared/schema'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import { decode, ScreenshotSchema } from './electrobun-preview-cdp-protocol'

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const PNG_SIGNATURE_BYTES = PNG_SIGNATURE.byteLength
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20
const PNG_HEADER_BYTES = 24

const LayoutMetricsSchema = Schema.Struct({
  cssVisualViewport: Schema.Struct({
    pageX: Schema.Number,
    pageY: Schema.Number,
    clientWidth: Schema.Number,
    clientHeight: Schema.Number,
  }),
})

/** One CDP command on a preview page. */
export type CdpSend = (method: string, params?: object) => Promise<unknown>

/** A region of the viewport, in CSS pixels. */
export interface CefViewportRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A `Page.captureScreenshot` clip: CSS pixels of the document, at a scale. */
export interface CefClip extends CefViewportRect {
  readonly scale: number
}

/** Width and height from a PNG's IHDR chunk. */
export function pngDimensions(png: Uint8Array) {
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

async function layoutViewport(send: CdpSend) {
  const metrics = decode(LayoutMetricsSchema, await send('Page.getLayoutMetrics'))
  if (metrics === null) throw new Error('The browser preview layout metrics are malformed.')
  return metrics.cssVisualViewport
}

/** The visible part of the page, in CSS pixels of the document. */
export async function visibleRegion(send: CdpSend) {
  const viewport = await layoutViewport(send)
  return {
    x: viewport.pageX,
    y: viewport.pageY,
    width: viewport.clientWidth,
    height: viewport.clientHeight,
    scale: 1,
  }
}

/** A region of the viewport as a clip of the document, which is how CDP takes clips. */
export async function documentClip(send: CdpSend, rect: CefViewportRect) {
  const viewport = await layoutViewport(send)
  return { ...rect, x: rect.x + viewport.pageX, y: rect.y + viewport.pageY, scale: 1 }
}

export async function captureCefPng(send: CdpSend, clip?: CefClip) {
  const shot = decode(
    ScreenshotSchema,
    await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }),
  )
  if (shot === null) throw new Error('The browser preview screenshot is malformed.')
  return Buffer.from(shot.data, 'base64')
}

/**
 * A PNG of the visible page, or of `rect` of its viewport, with at most the screenshot pixel
 * budget. CEF captures at device pixels and the main process has no image library, so an image
 * over the budget is captured again at a smaller CDP scale.
 */
export async function captureBoundedCefPng(send: CdpSend, rect?: CefViewportRect) {
  const clip = rect === undefined ? undefined : await documentClip(send, rect)
  const png = await captureCefPng(send, clip)
  const { width, height } = pngDimensions(png)
  const area = width * height
  if (area <= BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_PIXELS) return png
  const region = clip ?? (await visibleRegion(send))
  const scale = Math.sqrt(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_PIXELS / area)
  return captureCefPng(send, { ...region, scale: region.scale * scale })
}
