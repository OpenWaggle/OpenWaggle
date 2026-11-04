import { match } from '@diegogbrisa/ts-match'
import sharp from 'sharp'

/** Numbered callouts drawn over a crop; `website-screenshot-capture-kit.ts` is the entry point. */

/** A rectangle in CSS pixels of the window, as Playwright's `boundingBox()` reports it. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Where a numbered badge sits around the outlined `region`. `band` puts it in a strip added
 * under the crop, with a line up to the region and no outline, so it never covers the control.
 */
export type BadgePlacement =
  | 'above'
  | 'below'
  | 'left'
  | 'right'
  | 'left-top'
  | 'inside-top-right'
  | 'band'

export interface Callout {
  readonly number: number
  readonly region: Region
  /** Defaults to `above`. */
  readonly badge?: BadgePlacement
}

const CALLOUT_COLOR = '#f2b544'
const CALLOUT_TEXT_COLOR = '#17181c'
const BADGE_RADIUS_PX = 11
const BADGE_GAP_PX = 4
const BADGE_FONT_PX = 13
const OUTLINE_PAD_PX = 3
const OUTLINE_CORNER_PX = 7
const OUTLINE_STROKE_PX = 1.5
const BAND_HEIGHT_PX = 48
const HALVES = 2

/** Callouts numbered 1, 2, 3… in the order given, which is the order the docs explain them. */
export function numbered(targets: readonly Omit<Callout, 'number'>[]): Callout[] {
  return targets.map((target, index) => ({ ...target, number: index + 1 }))
}

export function centerOf(region: Region) {
  return { x: region.x + region.width / HALVES, y: region.y + region.height / HALVES }
}

function badgeCentre(callout: Callout, clipBottom: number) {
  const { region } = callout
  const offset = BADGE_RADIUS_PX + BADGE_GAP_PX + OUTLINE_PAD_PX
  const insideTop = region.y - OUTLINE_PAD_PX + BADGE_GAP_PX + BADGE_RADIUS_PX
  const { x: centreX, y: centreY } = centerOf(region)
  return match(callout.badge ?? 'above')
    .with('above', () => ({ x: centreX, y: region.y - offset }))
    .with('below', () => ({ x: centreX, y: region.y + region.height + offset }))
    .with('left', () => ({ x: region.x - offset, y: centreY }))
    .with('right', () => ({ x: region.x + region.width + offset, y: centreY }))
    .with('left-top', () => ({ x: region.x - offset, y: insideTop }))
    .with('inside-top-right', () => ({
      x: region.x + region.width + OUTLINE_PAD_PX - BADGE_GAP_PX - BADGE_RADIUS_PX,
      y: insideTop,
    }))
    .with('band', () => ({ x: centreX, y: clipBottom + BAND_HEIGHT_PX / HALVES }))
    .exhaustive()
}

/** One callout's shapes, in CSS pixels of the page (the SVG is translated to the clip). */
function calloutShapes(callout: Callout, clipBottom: number) {
  const { region } = callout
  const badge = badgeCentre(callout, clipBottom)
  const marker =
    callout.badge === 'band'
      ? `<line x1="${String(badge.x)}" y1="${String(badge.y - BADGE_RADIUS_PX)}" x2="${String(badge.x)}" y2="${String(region.y + region.height + BADGE_GAP_PX)}" stroke="${CALLOUT_COLOR}" stroke-width="${String(OUTLINE_STROKE_PX)}"/>`
      : `<rect x="${String(region.x - OUTLINE_PAD_PX)}" y="${String(region.y - OUTLINE_PAD_PX)}" width="${String(region.width + OUTLINE_PAD_PX * HALVES)}" height="${String(region.height + OUTLINE_PAD_PX * HALVES)}" rx="${String(OUTLINE_CORNER_PX)}" fill="none" stroke="${CALLOUT_COLOR}" stroke-width="${String(OUTLINE_STROKE_PX)}"/>`
  return [
    marker,
    `<circle cx="${String(badge.x)}" cy="${String(badge.y)}" r="${String(BADGE_RADIUS_PX)}" fill="${CALLOUT_COLOR}"/>`,
    `<text x="${String(badge.x)}" y="${String(badge.y)}" dy="0.36em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${String(BADGE_FONT_PX)}" fill="${CALLOUT_TEXT_COLOR}">${String(callout.number)}</text>`,
  ].join('')
}

/** The image with a strip of `band` pixels added under it, in its bottom-left pixel's colour. */
async function withBand(image: Buffer, height: number, band: number) {
  const { data } = await sharp(image)
    .extract({ left: 0, top: height - 1, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const [r = 0, g = 0, b = 0] = data
  return sharp(image)
    .extend({ bottom: band, background: { r, g, b, alpha: 1 } })
    .png()
    .toBuffer()
}

/**
 * Draws numbered callouts over an image of `clip`. Positions come from the controls' bounding
 * boxes, so the numbers land in the same place on every run; the SVG's view box is in CSS pixels,
 * so they look the same at any image scale. A `band` callout adds its strip under the image, in
 * the colour of the image's bottom-left pixel.
 */
export async function drawCallouts(image: Buffer, clip: Region, callouts: readonly Callout[]) {
  if (callouts.length === 0) return image
  const meta = await sharp(image).metadata()
  const width = meta.width ?? clip.width
  const height = meta.height ?? clip.height
  const scale = width / clip.width
  const band = callouts.some((callout) => callout.badge === 'band')
    ? Math.round(BAND_HEIGHT_PX * scale)
    : 0
  const base = band > 0 ? await withBand(image, height, band) : image
  const clipBottom = clip.y + height / scale
  const shapes = callouts.map((callout) => calloutShapes(callout, clipBottom)).join('')
  const viewBox = [clip.x, clip.y, width / scale, (height + band) / scale].map(String).join(' ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height + band)}" viewBox="${viewBox}">${shapes}</svg>`
  return sharp(base)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer()
}

