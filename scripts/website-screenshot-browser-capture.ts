import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { BROWSER_THREAD_TITLE } from './website-screenshot-fixture'
import { startFixtureSite } from './website-screenshot-fixture-site'
import {
  type CaptureContext,
  blurFocusedControl,
  closeRightPanel,
  openSession,
  setSessionSummary,
  showRailSurface,
  waitForUi,
} from './website-screenshot-ui'

const GUEST_TIMEOUT_MS = 30_000
const GUEST_POLL_MS = 100

interface ViewBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The window's native WebContentsView children showing `url`, with their bounds in the window. */
async function guestViewBounds(context: CaptureContext, url: string) {
  return context.app.evaluate(({ BrowserWindow, WebContentsView }, guestUrl) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return []
    return window.contentView.children.flatMap((child) =>
      child instanceof WebContentsView && child.webContents.getURL().startsWith(guestUrl)
        ? [child.getBounds()]
        : [],
    )
  }, url)
}

async function waitForGuest(context: CaptureContext, url: string) {
  const deadline = Date.now() + GUEST_TIMEOUT_MS
  while (Date.now() < deadline) {
    const page = context.app.windows().find((candidate) => candidate.url().startsWith(url))
    const bounds = await guestViewBounds(context, url)
    if (page && bounds.length === 1 && bounds[0]) {
      await page.waitForLoadState('load')
      return { page, bounds: bounds[0] }
    }
    await new Promise((resolve) => setTimeout(resolve, GUEST_POLL_MS))
  }
  throw new Error(`The Browser preview did not show ${url}.`)
}

/**
 * Hidden-window screenshots on macOS can leave out a native WebContentsView even when its page
 * is loaded (MEMORY.md, Electron Runtime). Capture the renderer and the guest page separately at
 * CSS-pixel scale and place the guest's pixels at its view's bounds.
 */
async function compositeGuest(input: {
  readonly renderer: Buffer
  readonly guest: Buffer
  readonly bounds: ViewBounds
}) {
  const guestMeta = await sharp(input.guest).metadata()
  if (guestMeta.width !== input.bounds.width || guestMeta.height !== input.bounds.height) {
    throw new Error(
      `Browser guest is ${String(guestMeta.width)}x${String(guestMeta.height)}, but its view is ${String(input.bounds.width)}x${String(input.bounds.height)}.`,
    )
  }
  return sharp(input.renderer)
    .composite([{ input: input.guest, left: input.bounds.x, top: input.bounds.y }])
    .png()
    .toBuffer()
}

async function openPreview(page: Page, url: string) {
  const address = page.getByRole('textbox', { name: 'Preview address' }).first()
  await address.waitFor({ timeout: GUEST_TIMEOUT_MS })
  await address.fill(url)
  await address.press('Enter')
  await waitForUi(page)
}

/** The Browser preview beside a conversation, showing a local fixture site. */
export async function captureBrowserPreview(context: CaptureContext) {
  const site = await startFixtureSite()
  try {
    const { page } = context
    await openSession(page, BROWSER_THREAD_TITLE)
    await setSessionSummary(page, false)
    await showRailSurface(page, 'Browser')
    await openPreview(page, site.url)
    const guest = await waitForGuest(context, site.url)
    await page.mouse.move(1, 1)
    await blurFocusedControl(page)
    const renderer = await page.screenshot({ animations: 'disabled', scale: 'css' })
    const guestImage = await guest.page.screenshot({ animations: 'disabled', scale: 'css' })
    const composite = await compositeGuest({ renderer, guest: guestImage, bounds: guest.bounds })
    const file = 'feature-browser-preview.png'
    await fs.writeFile(path.join(context.outputDir, file), composite)
    // The originals and bounds stay with the evidence, so the composite can be checked.
    await fs.writeFile(path.join(context.evidenceDir, `${file}.renderer.png`), renderer)
    await fs.writeFile(path.join(context.evidenceDir, `${file}.guest.png`), guestImage)
    await fs.writeFile(
      path.join(context.evidenceDir, `${file}.bounds.json`),
      `${JSON.stringify(guest.bounds)}\n`,
    )
    await fs.copyFile(path.join(context.outputDir, file), path.join(context.evidenceDir, file))
    console.info(`[website-shots] wrote ${file} (renderer and guest composited)`)
    await closeRightPanel(page)
  } finally {
    await site.close()
  }
}
