import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { drawOutline, type Region } from './website-screenshot-outline'
import { blurFocusedControl, type CaptureContext, UI_TIMEOUT_MS } from './website-screenshot-ui'

/**
 * The one crop, outline and image-writing kit every website capture uses. Regions are CSS pixels
 * of the window, as Playwright's `boundingBox()` reports them; crops are taken at twice that
 * size, so small controls stay sharp on high-density screens, and every image is written as a
 * 256-colour palette PNG except the full-window originals, which stay lossless.
 */

export { centerOf, type Region } from './website-screenshot-outline'

/** Space around a crop's subject. */
export const CROP_MARGIN_PX = 16
const CROP_SCALE = 2
const SETTINGS_MAX_WIDTH_PX = 1600
/** A cropped page keeps its overlay scrollbar at the crop's edge, where it reads as a stray line. */
const HIDE_SCROLLBARS = '::-webkit-scrollbar { display: none !important; }'
const PNG_COLOURS = 256
const PNG_EFFORT = 10
const PNG_COMPRESSION_LEVEL = 9
const STABLE_POLL_MS = 200
const STABLE_ATTEMPTS = 25

export async function regionOf(locator: Locator): Promise<Region> {
  await locator.waitFor({ timeout: UI_TIMEOUT_MS })
  const box = await locator.boundingBox({ timeout: UI_TIMEOUT_MS })
  if (!box) throw new Error(`No bounding box for ${locator.toString()}.`)
  return box
}

/** The smallest region holding every one given, grown by `pad` on each side. */
export function unionRegion(
  regions: readonly Region[],
  pad: number | { readonly x: number; readonly y: number } = 0,
): Region {
  const padX = typeof pad === 'number' ? pad : pad.x
  const padY = typeof pad === 'number' ? pad : pad.y
  const left = Math.min(...regions.map((region) => region.x)) - padX
  const top = Math.min(...regions.map((region) => region.y)) - padY
  const right = Math.max(...regions.map((region) => region.x + region.width)) + padX
  const bottom = Math.max(...regions.map((region) => region.y + region.height)) + padY
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** `region` grown by `margin` on every side. */
export function around(region: Region, margin = CROP_MARGIN_PX) {
  return unionRegion([region], margin)
}

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

/** Whole CSS pixels inside the window, keeping the region's far edges where they were. */
function windowSize(page: Page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
}

async function clipInWindow(page: Page, region: Region): Promise<Region> {
  const view = await windowSize(page)
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  return {
    x,
    y,
    width: Math.min(view.width, Math.ceil(region.x + region.width)) - x,
    height: Math.min(view.height, Math.ceil(region.y + region.height)) - y,
  }
}

/** Parks the pointer and, unless asked not to, drops focus: no hover state or focus ring. */
export async function settleForShot(page: Page, keepFocus = false) {
  await page.mouse.move(1, 1)
  if (!keepFocus) await blurFocusedControl(page)
}

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

interface WriteOptions {
  /** Scales the image down to at most this many pixels wide. */
  readonly maxWidth?: number
  /** Writes the PNG as captured: the original full-window images are not reduced to a palette. */
  readonly lossless?: boolean
}

/** A palette PNG: the app's flat colours survive, and the file stays small. */
async function optimizePng(image: Buffer, maxWidth?: number) {
  const meta = await sharp(image).metadata()
  const pipeline =
    maxWidth !== undefined && meta.width > maxWidth
      ? sharp(image).resize({ width: maxWidth })
      : sharp(image)
  return pipeline
    .png({
      palette: true,
      colours: PNG_COLOURS,
      effort: PNG_EFFORT,
      compressionLevel: PNG_COMPRESSION_LEVEL,
    })
    .toBuffer()
}

/** Writes the website image, and a copy beside the run's other QA evidence. */
export async function writeScreenshot(
  context: CaptureContext,
  file: WebsiteScreenshot,
  image: Buffer,
  options: WriteOptions = {},
) {
  const target = path.join(context.outputDir, file)
  await fs.writeFile(target, options.lossless ? image : await optimizePng(image, options.maxWidth))
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}

interface ShotOptions extends WriteOptions {
  /** The one control the page is about, outlined; no image carries more than one. */
  readonly outline?: Region
  /** Keep focus where it is, for an open menu that closes when its field loses focus. */
  readonly keepFocus?: boolean
  /** Hides overlay scrollbars, which a crop would otherwise keep at its edge as a stray line. */
  readonly hideScrollbars?: boolean
}

/**
 * A region of the window at twice CSS size, with an optional outline. A region given as a function
 * is measured after the pointer and focus have settled, since leaving a control can scroll the
 * page under it.
 */
export async function shootRegion(
  context: CaptureContext,
  file: WebsiteScreenshot,
  region: Region | (() => Promise<Region>),
  options: ShotOptions = {},
) {
  const { page } = context
  await settleForShot(page, options.keepFocus)
  const clip = await clipInWindow(
    page,
    typeof region === 'function' ? await stableRegion(region) : region,
  )
  const pixels = await page.screenshot({
    clip,
    animations: 'disabled',
    scale: 'device',
    ...(options.hideScrollbars ? { style: HIDE_SCROLLBARS } : {}),
  })
  // A display at another density would change the image size; keep every run's the same.
  const size = { width: clip.width * CROP_SCALE, height: clip.height * CROP_SCALE }
  const meta = await sharp(pixels).metadata()
  const image =
    meta.width === size.width ? pixels : await sharp(pixels).resize(size).png().toBuffer()
  await writeScreenshot(context, file, await drawOutline(image, clip, options.outline), options)
}

/** The whole window at CSS scale, like the overview images. */
export async function shootWindow(
  context: CaptureContext,
  file: WebsiteScreenshot,
  options: ShotOptions = {},
) {
  const { page } = context
  await settleForShot(page, options.keepFocus)
  const image = await page.screenshot({ animations: 'disabled', scale: 'css' })
  const clip = { x: 0, y: 0, ...(await windowSize(page)) }
  await writeScreenshot(context, file, await drawOutline(image, clip, options.outline), options)
}

/**
 * The Settings content to the right of the section list, down to `bottom` (CSS pixels), scaled to
 * at most `SETTINGS_MAX_WIDTH_PX` so a whole Settings page reads at the size of the other images.
 */
export async function shootSettingsContent(
  context: CaptureContext,
  file: WebsiteScreenshot,
  bottom?: number,
) {
  const { page } = context
  const navigation = await regionOf(
    page.getByRole('navigation').filter({ hasText: 'Permissions' }).last(),
  )
  const view = await windowSize(page)
  const left = navigation.x + navigation.width
  await shootRegion(
    context,
    file,
    {
      x: left,
      y: navigation.y,
      width: view.width - left,
      height: (bottom ?? view.height) - navigation.y,
    },
    { maxWidth: SETTINGS_MAX_WIDTH_PX, hideScrollbars: true },
  )
}

/** How many image pixels one CSS pixel covers in a `scale: 'device'` screenshot. */
export function devicePixelRatio(page: Page) {
  return page.evaluate(() => window.devicePixelRatio)
}

function scaled(region: Region, ratio: number) {
  return {
    left: Math.round(region.x * ratio),
    top: Math.round(region.y * ratio),
    width: Math.round(region.width * ratio),
    height: Math.round(region.height * ratio),
  }
}

/**
 * Places a Browser preview guest's own screenshot at its native view's bounds, at any screenshot
 * scale. A hidden window's screenshot leaves the native view out (.agents/memory/electron-shell.md).
 */
export async function compositeGuestImage(input: {
  readonly renderer: Buffer
  readonly guest: Buffer
  readonly bounds: Region
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

/** Cuts `region` out of a screenshot taken at `ratio` image pixels per CSS pixel. */
export async function cropImage(image: Buffer, region: Region, ratio: number) {
  const meta = await sharp(image).metadata()
  const area = scaled(region, ratio)
  const left = Math.max(0, area.left)
  const top = Math.max(0, area.top)
  const width = Math.min(area.width, meta.width - left)
  const height = Math.min(area.height, meta.height - top)
  return sharp(image).extract({ left, top, width, height }).png().toBuffer()
}
