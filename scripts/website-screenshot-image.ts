import fs from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { type CaptureContext, blurFocusedControl } from './website-screenshot-ui'

/** A rectangle in the window's CSS pixels, as Playwright and Electron report it. */
export interface CssRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Where a numbered badge sits: inside the outline's top-right corner, or outside it on the left,
 * centred or level with its top.
 */
export type CalloutBadgePlacement = 'inside-top-right' | 'outside-left' | 'outside-left-top'

export interface Callout {
  readonly label: string
  readonly region: CssRegion
  readonly badge: CalloutBadgePlacement
}

const PNG_COMPRESSION_LEVEL = 9
const PNG_EFFORT = 10
const CALLOUT_COLOR = '#38bdf8'
const CALLOUT_INK = '#0b1220'
const CALLOUT_STROKE_PX = 3
const CALLOUT_RADIUS_PX = 10
const CALLOUT_PADDING_PX = 4
const BADGE_RADIUS_PX = 15
const BADGE_GAP_PX = 6
const BADGE_FONT_PX = 17
/** The badge's number sits a little below the circle's centre to look centred. */
const BADGE_BASELINE_SHIFT = 0.35
const HALF = 2
const BOUNDING_BOX_TIMEOUT_MS = 30_000

/** How many image pixels one CSS pixel covers in a `scale: 'device'` screenshot. */
export function devicePixelRatio(page: Page) {
  return page.evaluate(() => window.devicePixelRatio)
}

/** Parks the pointer and drops focus: no hover state, tooltip or focus ring in the image. */
export async function settleForShot(page: Page) {
  await page.mouse.move(1, 1)
  await blurFocusedControl(page)
}

export async function regionOf(locator: Locator): Promise<CssRegion> {
  const box = await locator.boundingBox({ timeout: BOUNDING_BOX_TIMEOUT_MS })
  if (box === null) throw new Error(`No bounding box for ${String(locator)}.`)
  return box
}

function scaled(region: CssRegion, ratio: number) {
  return {
    left: Math.round(region.x * ratio),
    top: Math.round(region.y * ratio),
    width: Math.round(region.width * ratio),
    height: Math.round(region.height * ratio),
  }
}

/**
 * Places a Browser preview guest's own screenshot at its native view's bounds (see
 * `website-screenshot-browser-capture.ts`), at any screenshot scale.
 */
export async function compositeGuestImage(input: {
  readonly renderer: Buffer
  readonly guest: Buffer
  readonly bounds: CssRegion
  readonly ratio: number
}) {
  const target = scaled(input.bounds, input.ratio)
  const guestMeta = await sharp(input.guest).metadata()
  if (guestMeta.width !== target.width || guestMeta.height !== target.height) {
    throw new Error(
      `Browser guest is ${String(guestMeta.width)}x${String(guestMeta.height)}, but its view is ${String(target.width)}x${String(target.height)}.`,
    )
  }
  return sharp(input.renderer)
    .composite([{ input: input.guest, left: target.left, top: target.top }])
    .png()
    .toBuffer()
}

/** Cuts `region` (CSS pixels) out of a screenshot taken at `ratio` image pixels per CSS pixel. */
export async function cropImage(image: Buffer, region: CssRegion, ratio: number) {
  const meta = await sharp(image).metadata()
  const area = scaled(region, ratio)
  const left = Math.max(0, area.left)
  const top = Math.max(0, area.top)
  const width = Math.min(area.width, (meta.width ?? 0) - left)
  const height = Math.min(area.height, (meta.height ?? 0) - top)
  return sharp(image).extract({ left, top, width, height }).png().toBuffer()
}

function badgeCentre(callout: Callout) {
  const { region } = callout
  const outsideLeft = region.x - CALLOUT_PADDING_PX - BADGE_GAP_PX - BADGE_RADIUS_PX
  const insideTop = region.y - CALLOUT_PADDING_PX + BADGE_GAP_PX + BADGE_RADIUS_PX
  return match(callout.badge)
    .with('outside-left', () => ({ x: outsideLeft, y: region.y + region.height / HALF }))
    .with('outside-left-top', () => ({ x: outsideLeft, y: insideTop }))
    .with('inside-top-right', () => ({
      x: region.x + region.width + CALLOUT_PADDING_PX - BADGE_GAP_PX - BADGE_RADIUS_PX,
      y: insideTop,
    }))
    .exhaustive()
}

function calloutSvg(
  callouts: readonly Callout[],
  image: { readonly width: number; readonly height: number },
  ratio: number,
) {
  const shapes = callouts.map((callout) => {
    const { region } = callout
    const centre = badgeCentre(callout)
    return [
      `<rect x="${String(region.x - CALLOUT_PADDING_PX)}" y="${String(region.y - CALLOUT_PADDING_PX)}"`,
      ` width="${String(region.width + CALLOUT_PADDING_PX * HALF)}" height="${String(region.height + CALLOUT_PADDING_PX * HALF)}"`,
      ` rx="${String(CALLOUT_RADIUS_PX)}" fill="none" stroke="${CALLOUT_COLOR}" stroke-width="${String(CALLOUT_STROKE_PX)}"/>`,
      `<circle cx="${String(centre.x)}" cy="${String(centre.y)}" r="${String(BADGE_RADIUS_PX)}"`,
      ` fill="${CALLOUT_COLOR}" stroke="${CALLOUT_INK}" stroke-width="${String(HALF)}"/>`,
      `<text x="${String(centre.x)}" y="${String(centre.y + BADGE_FONT_PX * BADGE_BASELINE_SHIFT)}"`,
      ` text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${String(BADGE_FONT_PX)}"`,
      ` font-weight="700" fill="${CALLOUT_INK}">${callout.label}</text>`,
    ].join('')
  })
  const viewBox = `0 0 ${String(image.width / ratio)} ${String(image.height / ratio)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(image.width)}" height="${String(image.height)}" viewBox="${viewBox}">${shapes.join('')}</svg>`
}

/**
 * Draws numbered outlines at element bounding boxes. The SVG's view box is in CSS pixels and its
 * size is the screenshot's, so the same callouts stay sharp at any device pixel ratio.
 */
export async function drawCallouts(image: Buffer, callouts: readonly Callout[], ratio: number) {
  const meta = await sharp(image).metadata()
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 }
  const svg = Buffer.from(calloutSvg(callouts, size, ratio))
  return sharp(image).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer()
}

/** Writes the website image as an optimized palette PNG, and a copy beside the QA evidence. */
export async function writeScreenshot(
  context: CaptureContext,
  file: WebsiteScreenshot,
  image: Buffer,
) {
  const target = path.join(context.outputDir, file)
  await sharp(image)
    .png({ palette: true, compressionLevel: PNG_COMPRESSION_LEVEL, effort: PNG_EFFORT })
    .toFile(target)
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}
