import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { type CaptureContext, blurFocusedControl } from './website-screenshot-ui'

/** A rectangle in the window's CSS pixels, as Playwright's `boundingBox()` gives it. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A numbered marker: an outline around `target` and a badge on the given side of it. */
export interface Callout {
  readonly target: Region
  readonly placement: 'above' | 'below' | 'left' | 'right'
}

const CALLOUT_COLOR = '#f5a524'
const CALLOUT_TEXT_COLOR = '#16181d'
const BADGE_RADIUS_PX = 11
const BADGE_GAP_PX = 6
const BADGE_FONT_SIZE_PX = 13
const OUTLINE_WIDTH_PX = 2
const OUTLINE_PADDING_PX = 3
const OUTLINE_RADIUS_PX = 6
const PNG_COMPRESSION_LEVEL = 9
const PNG_PALETTE_COLORS = 256
/** A centre is half the size from an edge; the outline pads both sides. */
const HALVES = 2

export async function regionOf(locator: Locator): Promise<Region> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`No bounding box for ${locator.toString()}`)
  return box
}

export function centerOf(region: Region) {
  return { x: region.x + region.width / HALVES, y: region.y + region.height / HALVES }
}

/** The smallest region holding all of `regions`, grown by `padding` and kept inside the window. */
export async function enclosingRegion(
  page: Page,
  regions: readonly Region[],
  padding: { readonly x: number; readonly y: number },
): Promise<Region> {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const left = Math.max(0, Math.min(...regions.map((region) => region.x)) - padding.x)
  const top = Math.max(0, Math.min(...regions.map((region) => region.y)) - padding.y)
  const right = Math.min(viewport.width, Math.max(...regions.map((region) => region.x + region.width)) + padding.x)
  const bottom = Math.min(viewport.height, Math.max(...regions.map((region) => region.y + region.height)) + padding.y)
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

function badgeCenter(callout: Callout) {
  const { target } = callout
  const offset = BADGE_RADIUS_PX + BADGE_GAP_PX + OUTLINE_PADDING_PX
  const { x: centerX, y: centerY } = centerOf(target)
  if (callout.placement === 'above') return { x: centerX, y: target.y - offset }
  if (callout.placement === 'below') return { x: centerX, y: target.y + target.height + offset }
  if (callout.placement === 'left') return { x: target.x - offset, y: centerY }
  return { x: target.x + target.width + offset, y: centerY }
}

/** The callouts as one SVG over the clip, drawn at the image's pixel scale. */
function calloutSvg(input: {
  readonly clip: Region
  readonly callouts: readonly Callout[]
  readonly scale: number
  readonly width: number
  readonly height: number
}) {
  const { clip, scale } = input
  const shapes = input.callouts.map((callout, index) => {
    const { target } = callout
    const x = (target.x - clip.x - OUTLINE_PADDING_PX) * scale
    const y = (target.y - clip.y - OUTLINE_PADDING_PX) * scale
    const width = (target.width + OUTLINE_PADDING_PX * HALVES) * scale
    const height = (target.height + OUTLINE_PADDING_PX * HALVES) * scale
    const badge = badgeCenter(callout)
    const badgeX = (badge.x - clip.x) * scale
    const badgeY = (badge.y - clip.y) * scale
    return [
      `<rect x="${String(x)}" y="${String(y)}" width="${String(width)}" height="${String(height)}" rx="${String(OUTLINE_RADIUS_PX * scale)}" fill="none" stroke="${CALLOUT_COLOR}" stroke-width="${String(OUTLINE_WIDTH_PX * scale)}"/>`,
      `<circle cx="${String(badgeX)}" cy="${String(badgeY)}" r="${String(BADGE_RADIUS_PX * scale)}" fill="${CALLOUT_COLOR}"/>`,
      `<text x="${String(badgeX)}" y="${String(badgeY)}" dy="0.36em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${String(BADGE_FONT_SIZE_PX * scale)}" fill="${CALLOUT_TEXT_COLOR}">${String(index + 1)}</text>`,
    ].join('')
  })
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(input.width)}" height="${String(input.height)}">${shapes.join('')}</svg>`,
  )
}

/**
 * A crop of the window at the display's pixel scale, with numbered callouts drawn over it and the
 * PNG reduced to a palette. The pointer is parked and focus cleared first, as `shoot()` does.
 */
export async function shootRegion(
  context: CaptureContext,
  file: WebsiteScreenshot,
  input: { readonly clip: Region; readonly callouts?: readonly Callout[] },
) {
  const { page } = context
  await page.mouse.move(1, 1)
  await blurFocusedControl(page)
  const raw = await page.screenshot({ clip: input.clip, animations: 'disabled', scale: 'device' })
  const meta = await sharp(raw).metadata()
  const width = meta.width ?? input.clip.width
  const height = meta.height ?? input.clip.height
  const callouts = input.callouts ?? []
  const annotated =
    callouts.length === 0
      ? sharp(raw)
      : sharp(raw).composite([
          {
            input: calloutSvg({ clip: input.clip, callouts, scale: width / input.clip.width, width, height }),
            left: 0,
            top: 0,
          },
        ])
  const image = await sharp(await annotated.png().toBuffer())
    .png({ palette: true, colours: PNG_PALETTE_COLORS, compressionLevel: PNG_COMPRESSION_LEVEL })
    .toBuffer()
  const target = path.join(context.outputDir, file)
  await fs.writeFile(target, image)
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file} (${String(width)}x${String(height)})`)
}
