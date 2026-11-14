import type { Page } from '@playwright/test'
import { openPreview, waitForGuest } from './website-screenshot-browser-capture'
import {
  around,
  centerOf,
  compositeGuestImage,
  cropImage,
  devicePixelRatio,
  regionOf,
  settleForShot,
  writeScreenshot,
} from './website-screenshot-capture-kit'
import { BROWSER_THREAD_TITLE } from './website-screenshot-fixture'
import { type FixtureSite, startFixtureSite } from './website-screenshot-fixture-site'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  setSessionSummary,
  showRailSurface,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

/** iPhone SE fits the panel at full size, so the guest is not scaled down to fit. */
const PHONE_PRESET_ID = 'iphone-se'
const PHONE_WIDTH_PX = 375
const PHONE_HEIGHT_PX = 667
const GUEST_RESIZE_TIMEOUT_MS = 30_000
const GUEST_POLL_MS = 100
const ANNOTATION_COMMENT = 'The third card is cut off on phones. Stack the stats in one column.'
const ANNOTATED_MESSAGE = 'Fix this on phone widths and keep the cards readable.'

type PreviewGuest = Awaited<ReturnType<typeof waitForGuest>>

async function waitForPhoneGuest(context: CaptureContext, url: string) {
  const deadline = Date.now() + GUEST_RESIZE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const guest = await waitForGuest(context, url)
    if (guest.bounds.width === PHONE_WIDTH_PX && guest.bounds.height === PHONE_HEIGHT_PX) {
      return guest
    }
    await new Promise((resolve) => setTimeout(resolve, GUEST_POLL_MS))
  }
  throw new Error(`The Browser preview did not resize to ${PHONE_PRESET_ID}.`)
}

function deviceToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Device viewport controls' })
}

function browserPanel(page: Page) {
  return page
    .getByRole('complementary')
    .filter({ has: page.getByRole('region', { name: 'Browser preview' }) })
}

/** The fixture dashboard in the Browser preview, in a phone viewport from the device toolbar. */
async function showPhonePreview(context: CaptureContext, site: FixtureSite) {
  const { page } = context
  await openSession(page, BROWSER_THREAD_TITLE)
  await setSessionSummary(page, false)
  await showRailSurface(page, 'Browser')
  await openPreview(page, site.url)
  await waitForGuest(context, site.url)
  if (!(await deviceToolbar(page).isVisible())) {
    await page.getByRole('button', { name: 'Browser preview options' }).click()
    await page.getByRole('menuitem', { name: 'Open device toolbar' }).click()
    await deviceToolbar(page).waitFor({ timeout: UI_TIMEOUT_MS })
  }
  await deviceToolbar(page)
    .getByRole('combobox', { name: 'Device preset' })
    .selectOption(PHONE_PRESET_ID)
  const guest = await waitForPhoneGuest(context, site.url)
  await waitForUi(page)
  return guest
}

async function closePhonePreview(page: Page) {
  await deviceToolbar(page).getByRole('button', { name: 'Close device toolbar' }).click()
  await deviceToolbar(page).waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  await closeRightPanel(page)
}

/** The Browser panel with the guest page composited in, at the screen's pixel density. */
async function shootBrowserPanel(
  context: CaptureContext,
  guest: PreviewGuest,
  file: WebsiteScreenshot,
) {
  const { page } = context
  await settleForShot(page)
  const ratio = await devicePixelRatio(page)
  const panel = await regionOf(browserPanel(page))
  const renderer = await page.screenshot({ animations: 'disabled', scale: 'device' })
  const guestImage = await guest.page.screenshot({ animations: 'disabled', scale: 'device' })
  const composite = await compositeGuestImage({
    renderer,
    guest: guestImage,
    bounds: guest.bounds,
    ratio,
  })
  await writeScreenshot(context, file, await cropImage(composite, panel, ratio))
}

async function withFixtureSite(run: (site: FixtureSite) => Promise<void>) {
  const site = await startFixtureSite()
  try {
    await run(site)
  } finally {
    await site.close()
  }
}

/** The device toolbar with the fixture dashboard in a phone-sized viewport. */
export async function captureBrowserDeviceToolbar(context: CaptureContext) {
  await withFixtureSite(async (site) => {
    const guest = await showPhonePreview(context, site)
    await shootBrowserPanel(context, guest, 'browser-preview-device-toolbar.png')
    await closePhonePreview(context.page)
  })
}

/**
 * Annotate preview for message with the stats row selected and a comment typed. The annotation
 * tools live in a closed shadow root in the guest page, so this drives them with real pointer and
 * keyboard input rather than locators.
 */
async function annotateStatsRow(context: CaptureContext, site: FixtureSite) {
  const { page } = context
  const guest = await showPhonePreview(context, site)
  await page.getByRole('button', { name: 'Annotate preview for message' }).click()
  await guest.page
    .locator('html[data-openwaggle-annotation-tool]')
    .waitFor({ state: 'attached', timeout: UI_TIMEOUT_MS })
  // The gap between two stat cards belongs to their row, so the click selects `section.stats`.
  const cards = await guest.page.locator('.stat').evaluateAll((elements) =>
    elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { left, right, top, bottom }
    }),
  )
  const [first, second] = cards
  if (!first || !second) throw new Error('The fixture dashboard has no stat cards.')
  const gap = centerOf({
    x: first.right,
    y: first.top,
    width: second.left - first.right,
    height: first.bottom - first.top,
  })
  await guest.page.mouse.click(gap.x, gap.y)
  await waitForUi(page)
  await guest.page.keyboard.type(ANNOTATION_COMMENT)
  await waitForUi(page)
  return guest
}

/** The annotation editor over the phone-sized page, before it is attached. */
export async function captureBrowserAnnotation(context: CaptureContext) {
  await withFixtureSite(async (site) => {
    const guest = await annotateStatsRow(context, site)
    await shootBrowserPanel(context, guest, 'browser-preview-annotation.png')
    await guest.page.keyboard.press('Escape')
    await guest.page
      .locator('html[data-openwaggle-annotation-tool]')
      .waitFor({ state: 'detached', timeout: UI_TIMEOUT_MS })
    await closePhonePreview(context.page)
  })
}

/** The chip an attached annotation adds to the message draft, with the request typed after it. */
export async function captureBrowserAnnotationChip(context: CaptureContext) {
  const { page } = context
  await withFixtureSite(async (site) => {
    const guest = await annotateStatsRow(context, site)
    await guest.page.keyboard.press('Enter')
    const removeChip = page.getByRole('button', { name: /^Remove browser annotation for / })
    await removeChip.waitFor({ timeout: UI_TIMEOUT_MS })
    const message = page.getByRole('textbox', { name: 'Message input' })
    await message.fill(ANNOTATED_MESSAGE)
    await settleForShot(page)
    const ratio = await devicePixelRatio(page)
    const composer = await regionOf(page.getByRole('region', { name: 'Composer file drop zone' }))
    // Room around the composer, so its outline is not cut by the crop.
    const area = around(composer)
    const windowImage = await page.screenshot({ animations: 'disabled', scale: 'device' })
    await writeScreenshot(
      context,
      'browser-preview-annotation-chip.png',
      await cropImage(windowImage, area, ratio),
    )
    // Leave the Session's draft and panel as the earlier captures found them.
    await removeChip.click()
    await message.fill('')
    await closePhonePreview(page)
  })
}
