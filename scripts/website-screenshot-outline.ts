import sharp from 'sharp'

/**
 * The one highlight a website image may carry (ADR 0061): a thin outline around the control the
 * page is about. `website-screenshot-capture-kit.ts` is the entry point.
 */

/** A rectangle in CSS pixels of the window, as Playwright's `boundingBox()` reports it. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const OUTLINE_COLOR = '#f2b544'
const OUTLINE_PAD_PX = 3
const OUTLINE_CORNER_PX = 7
const OUTLINE_STROKE_PX = 1.5
const HALVES = 2

export function centerOf(region: Region) {
  return { x: region.x + region.width / HALVES, y: region.y + region.height / HALVES }
}

/**
 * Draws one outline around `region` over an image of `clip`. The SVG's view box is in CSS pixels,
 * so the stroke looks the same at any image scale and lands in the same place on every run.
 */
export async function drawOutline(image: Buffer, clip: Region, region: Region | undefined) {
  if (!region) return image
  const meta = await sharp(image).metadata()
  const { width, height } = meta
  const scale = width / clip.width
  const viewBox = [clip.x, clip.y, width / scale, height / scale].map(String).join(' ')
  const rect = `<rect x="${String(region.x - OUTLINE_PAD_PX)}" y="${String(region.y - OUTLINE_PAD_PX)}" width="${String(region.width + OUTLINE_PAD_PX * HALVES)}" height="${String(region.height + OUTLINE_PAD_PX * HALVES)}" rx="${String(OUTLINE_CORNER_PX)}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${String(OUTLINE_STROKE_PX)}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="${viewBox}">${rect}</svg>`
  return sharp(image)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer()
}
