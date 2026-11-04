import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import sharp, { type Sharp } from 'sharp'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { type CaptureContext, blurFocusedControl, waitForUi } from './website-screenshot-ui'

/** Crop, callout and window helpers shared by the feature-page captures. */

export const UI_TIMEOUT_MS = 30_000
export const WINDOW_WIDTH_PX = 1600
export const WINDOW_HEIGHT_PX = 1000
/** Crops are taken at device scale (2x on Retina) and scaled to at most this width. */
const MAX_CROP_WIDTH_PX = 1600
export const CROP_MARGIN_PX = 16
const CALLOUT_RADIUS_PX = 15
const CALLOUT_FONT_PX = 17
const CALLOUT_GAP_PX = 4
const CALLOUT_BAND_PX = 48
const TWICE = 2
const HALF = 0.5
/** sharp's palette PNG settings: near-lossless quantization at maximum compression. */
const PNG_QUALITY = 95
const PNG_EFFORT = 10
const PNG_COMPRESSION = 9

export interface Clip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A palette PNG keeps flat UI captures well under the website's size budget. */
export async function optimizePng(image: Buffer | Sharp) {
  const pipeline = Buffer.isBuffer(image) ? sharp(image) : image
  const metadata = await pipeline.clone().metadata()
  const resized =
    metadata.width !== undefined && metadata.width > MAX_CROP_WIDTH_PX
      ? pipeline.resize({ width: MAX_CROP_WIDTH_PX })
      : pipeline
  return resized.png({
    palette: true,
    quality: PNG_QUALITY,
    effort: PNG_EFFORT,
    compressionLevel: PNG_COMPRESSION,
  }).toBuffer()
}

export async function writeScreenshot(context: CaptureContext, file: WebsiteScreenshot, image: Buffer) {
  const target = path.join(context.outputDir, file)
  await fs.writeFile(target, image)
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}

async function settle(page: Page) {
  await page.mouse.move(1, 1)
  await blurFocusedControl(page)
}

/**
 * A region of the window at device scale, so small controls stay sharp. A cropped page keeps
 * its overlay scrollbar at the crop's edge, where it reads as a stray line, so it is hidden.
 */
export async function captureClip(page: Page, clip: Clip) {
  await settle(page)
  return page.screenshot({
    clip,
    animations: 'disabled',
    scale: 'device',
    style: '::-webkit-scrollbar { display: none !important; }',
  })
}

export async function shootClip(context: CaptureContext, file: WebsiteScreenshot, clip: Clip) {
  await writeScreenshot(context, file, await optimizePng(await captureClip(context.page, clip)))
}

export async function shootWindow(context: CaptureContext, file: WebsiteScreenshot) {
  await settle(context.page)
  const image = await context.page.screenshot({ animations: 'disabled', scale: 'css' })
  await writeScreenshot(context, file, await optimizePng(image))
}

export async function box(locator: Locator) {
  await locator.waitFor({ timeout: UI_TIMEOUT_MS })
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('A screenshot target has no bounding box.')
  return bounds
}

export function around(bounds: Clip, margin = CROP_MARGIN_PX): Clip {
  return {
    x: Math.max(0, bounds.x - margin),
    y: Math.max(0, bounds.y - margin),
    width: bounds.width + TWICE * margin,
    height: bounds.height + TWICE * margin,
  }
}

async function setWindowSize(context: CaptureContext, size: { width: number; height: number }) {
  await context.app.evaluate(async ({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setBounds(bounds)
  }, size)
  await context.page.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    size,
  )
  await waitForUi(context.page)
}

export async function openSettingsSection(page: Page, section: string) {
  const back = page.getByRole('button', { name: 'Back to app' })
  if (!(await back.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await page.getByRole('button', { name: section, exact: true }).first().click()
  await waitForUi(page)
}

export async function leaveSettings(page: Page) {
  const back = page.getByRole('button', { name: 'Back to app' })
  if (await back.isVisible()) await back.click()
  await waitForUi(page)
}

interface Callout {
  readonly label: string
  /** Horizontal centre of the marker and the bottom of what it points to, in CSS pixels of the clip. */
  readonly x: number
  readonly pointsToY: number
}

/**
 * Numbered markers in a band added under a crop, each with a short line up to the element it
 * names. Positions come from the elements' bounding boxes, so the numbers land in the same place
 * on every run and never cover the control.
 */
export async function drawCallouts(image: Buffer, clip: Clip, callouts: readonly Callout[]) {
  const metadata = await sharp(image).metadata()
  const width = metadata.width ?? clip.width
  const height = metadata.height ?? clip.height
  const scale = width / clip.width
  const band = CALLOUT_BAND_PX * scale
  // The band takes the colour of the crop's bottom-left pixel.
  const { data } = await sharp(image)
    .extract({ left: 0, top: height - 1, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const [r = 0, g = 0, b = 0] = data
  const background = { r, g, b, alpha: 1 }
  const markers = callouts
    .map(({ label, x, pointsToY }) => {
      const cx = x * scale
      const r = CALLOUT_RADIUS_PX * scale
      const cy = height + band * HALF
      return [
        `<line x1="${String(cx)}" y1="${String(cy - r)}" x2="${String(cx)}" y2="${String((pointsToY + CALLOUT_GAP_PX) * scale)}" stroke="#f5a524" stroke-width="${String(TWICE * scale)}"/>`,
        `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" fill="#f5a524"/>`,
        `<text x="${String(cx)}" y="${String(cy)}" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${String(CALLOUT_FONT_PX * scale)}" fill="#14161a">${label}</text>`,
      ].join('')
    })
    .join('')
  const extendedHeight = height + Math.round(band)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(extendedHeight)}">${markers}</svg>`
  const extended = await sharp(image)
    .extend({ bottom: Math.round(band), background })
    .png()
    .toBuffer()
  return sharp(extended).composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
}

/** Runs a capture at another window size, then restores the standard one. */
export async function withWindowSize<T>(
  context: CaptureContext,
  size: { width: number; height: number },
  capture: () => Promise<T>,
) {
  await setWindowSize(context, size)
  try {
    return await capture()
  } finally {
    await setWindowSize(context, { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX })
  }
}

/** The settings content to the right of the section list, at device scale. */
export async function shootSettingsContent(
  context: CaptureContext,
  file: WebsiteScreenshot,
  bottom?: number,
) {
  const { page } = context
  const navigation = await box(page.getByRole('navigation').filter({ hasText: 'Permissions' }).last())
  const viewport = page.viewportSize() ?? { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX }
  const left = navigation.x + navigation.width
  await shootClip(context, file, {
    x: left,
    y: navigation.y,
    width: viewport.width - left,
    height: (bottom ?? viewport.height) - navigation.y,
  })
}
