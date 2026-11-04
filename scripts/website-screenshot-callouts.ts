import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import sharp, { type Sharp } from 'sharp'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { blurFocusedControl, type CaptureContext } from './website-screenshot-ui'

/** A rectangle in CSS pixels of the page. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A numbered label drawn at a control, explained in a list under the image. */
export interface Callout {
  readonly number: number
  readonly region: Region
}

/** Crops are taken at twice CSS size so small controls stay sharp on high-density screens. */
const CROP_SCALE = 2
const CALLOUT_RADIUS_PX = 11
const CALLOUT_GAP_PX = 4
const CALLOUT_OUTLINE_PAD_PX = 3
const CALLOUT_CORNER_PX = 7
const CALLOUT_FONT_PX = 13
const CALLOUT_COLOR = '#f2b544'
const CALLOUT_STROKE_PX = 1.5
const HALVES = 2
const PNG_COMPRESSION_LEVEL = 9
const CALLOUT_TEXT_COLOR = '#17181c'
const PNG_COLOURS = 256
const PNG_EFFORT = 10

export async function regionOf(locator: Locator): Promise<Region> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`No bounding box for ${locator.toString()}.`)
  return box
}

/** The smallest region holding every one given, grown by `pad` on each side. */
/**
 * From the top of `top` to the bottom of `bottom`, across `across`'s columns, padded by `pad`
 * except below, where `bottomPad` keeps the next block out of the crop.
 */
export function spanRegion(options: {
  readonly top: Region
  readonly bottom: Region
  readonly across: Region
  readonly pad: number
  readonly bottomPad?: number
}): Region {
  const { top, bottom, across, pad, bottomPad = pad } = options
  const y = top.y - pad
  return {
    x: across.x - pad,
    y,
    width: across.width + pad + pad,
    height: bottom.y + bottom.height + bottomPad - y,
  }
}

export function unionRegion(regions: readonly Region[], pad = 0): Region {
  const left = Math.min(...regions.map((region) => region.x)) - pad
  const top = Math.min(...regions.map((region) => region.y)) - pad
  const right = Math.max(...regions.map((region) => region.x + region.width)) + pad
  const bottom = Math.max(...regions.map((region) => region.y + region.height)) + pad
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function roundRegion(region: Region): Region {
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  return {
    x,
    y,
    width: Math.ceil(region.x + region.width) - x,
    height: Math.ceil(region.y + region.height) - y,
  }
}

/**
 * An outline around each control and a numbered badge centred above it, as an SVG the size of
 * the crop. Positions are deterministic: they come from the controls' bounding boxes.
 */
function calloutSvg(clip: Region, callouts: readonly Callout[]) {
  const scale = (value: number) => value * CROP_SCALE
  const shapes = callouts.map(({ number, region }) => {
    const left = region.x - clip.x - CALLOUT_OUTLINE_PAD_PX
    const top = region.y - clip.y - CALLOUT_OUTLINE_PAD_PX
    const width = region.width + CALLOUT_OUTLINE_PAD_PX + CALLOUT_OUTLINE_PAD_PX
    const height = region.height + CALLOUT_OUTLINE_PAD_PX + CALLOUT_OUTLINE_PAD_PX
    const cx = left + width / HALVES
    const cy = top - CALLOUT_GAP_PX - CALLOUT_RADIUS_PX
    return [
      `<rect x="${scale(left)}" y="${scale(top)}" width="${scale(width)}" height="${scale(height)}" rx="${scale(CALLOUT_CORNER_PX)}" fill="none" stroke="${CALLOUT_COLOR}" stroke-width="${scale(CALLOUT_STROKE_PX)}"/>`,
      `<circle cx="${scale(cx)}" cy="${scale(cy)}" r="${scale(CALLOUT_RADIUS_PX)}" fill="${CALLOUT_COLOR}"/>`,
      `<text x="${scale(cx)}" y="${scale(cy)}" dy="0.36em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${scale(CALLOUT_FONT_PX)}" fill="${CALLOUT_TEXT_COLOR}">${String(number)}</text>`,
    ].join('')
  })
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scale(clip.width)}" height="${scale(clip.height)}">${shapes.join('')}</svg>`,
  )
}

/** A lossless palette PNG: the app's flat colours survive, and the file stays small. */
function optimizedPng(image: Sharp) {
  return image
    .png({
      palette: true,
      colours: PNG_COLOURS,
      effort: PNG_EFFORT,
      compressionLevel: PNG_COMPRESSION_LEVEL,
    })
    .toBuffer()
}

async function writeScreenshot(context: CaptureContext, file: WebsiteScreenshot, png: Buffer) {
  const target = path.join(context.outputDir, file)
  await fs.writeFile(target, png)
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}

interface ShotOptions {
  readonly callouts?: readonly Callout[]
  /** Keep focus where it is, for an open menu that closes when its field loses focus. */
  readonly keepFocus?: boolean
}

async function settlePointer(page: Page, keepFocus: boolean) {
  // Park the pointer in a corner so no hover state or tooltip lands in the image.
  await page.mouse.move(1, 1)
  if (!keepFocus) await blurFocusedControl(page)
}

const STABLE_POLL_MS = 200
const STABLE_ATTEMPTS = 25

/** Measures until two readings agree, so a crop does not catch content mid-scroll. */
async function stableRegion(measure: () => Promise<Region>) {
  let previous = await measure()
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, STABLE_POLL_MS))
    const next = await measure()
    if (JSON.stringify(next) === JSON.stringify(previous)) return next
    previous = next
  }
  throw new Error('The capture region kept moving.')
}

/**
 * A region of the window at twice CSS size, with optional numbered callouts. A region given as a
 * function is measured after the pointer and focus have settled, since leaving a control can
 * scroll the page under it.
 */
export async function shootRegion(
  context: CaptureContext,
  file: WebsiteScreenshot,
  region: Region | (() => Promise<Region>),
  options: ShotOptions = {},
) {
  const callouts = options.callouts ?? []
  await settlePointer(context.page, options.keepFocus ?? false)
  const clip = roundRegion(typeof region === 'function' ? await stableRegion(region) : region)
  const pixels = await context.page.screenshot({ clip, animations: 'disabled', scale: 'device' })
  const metadata = await sharp(pixels).metadata()
  const expectedWidth = clip.width * CROP_SCALE
  // A display at another density would place the callouts wrongly; resize to the expected scale.
  const image =
    metadata.width === expectedWidth
      ? sharp(pixels)
      : sharp(pixels).resize({ width: expectedWidth, height: clip.height * CROP_SCALE })
  const base = await image.png().toBuffer()
  const annotated =
    callouts.length === 0
      ? sharp(base)
      : sharp(base).composite([{ input: calloutSvg(clip, callouts), left: 0, top: 0 }])
  await writeScreenshot(context, file, await optimizedPng(annotated))
}
