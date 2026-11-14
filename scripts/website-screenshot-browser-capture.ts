import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  compositeGuestImage,
  settleForShot,
  writeScreenshot,
} from './website-screenshot-capture-kit'
import { BROWSER_THREAD_TITLE } from './website-screenshot-fixture'
import { startFixtureSite } from './website-screenshot-fixture-site'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  setSessionSummary,
  showRailSurface,
  waitForUi,
} from './website-screenshot-ui'

const GUEST_TIMEOUT_MS = 30_000
const GUEST_POLL_MS = 100

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

export async function waitForGuest(context: CaptureContext, url: string) {
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

export async function openPreview(page: Page, url: string) {
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
    await settleForShot(page)
    // Hidden-window screenshots on macOS can leave out the native WebContentsView even when its
    // page is loaded (.agents/memory/electron-shell.md), so the guest is captured on its own.
    const renderer = await page.screenshot({ animations: 'disabled', scale: 'css' })
    const guestImage = await guest.page.screenshot({ animations: 'disabled', scale: 'css' })
    const composite = await compositeGuestImage({
      renderer,
      guest: guestImage,
      bounds: guest.bounds,
      ratio: 1,
    })
    const file = 'feature-browser-preview.png'
    await writeScreenshot(context, file, composite, { lossless: true })
    // The originals and bounds stay with the evidence, so the composite can be checked.
    await fs.writeFile(path.join(context.evidenceDir, `${file}.renderer.png`), renderer)
    await fs.writeFile(path.join(context.evidenceDir, `${file}.guest.png`), guestImage)
    await fs.writeFile(
      path.join(context.evidenceDir, `${file}.bounds.json`),
      `${JSON.stringify(guest.bounds)}\n`,
    )
    await closeRightPanel(page)
  } finally {
    await site.close()
  }
}
