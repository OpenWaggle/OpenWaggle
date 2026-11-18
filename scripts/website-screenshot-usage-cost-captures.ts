import type { Page } from '@playwright/test'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import {
  type CaptureContext,
  UI_TIMEOUT_MS,
  waitForUi,
  withWindowSize,
} from './website-screenshot-ui'
import { writeUsageCostSessions } from './website-screenshot-usage-cost-fixture'

/**
 * The Usage & Cost page over the made-up Pi sessions (`website-screenshot-usage-cost-fixture.ts`).
 * The page reads every Pi session file in the scratch agent directory, so these captures run
 * before any capture starts a real Run, whose session file would add a Temporary directory row.
 */

/**
 * Tall enough for the cards, the daily chart, both breakdowns and the first sessions; just wide
 * enough that By model and By project stay side by side.
 */
const USAGE_WINDOW = { width: 1040, height: 1600 } as const
/** The image ends after this many Sessions rows: the rest of the list looks the same. */
const SESSION_ROWS_SHOWN = 5
/** Above and below the sidebar's footer row. */
const FOOTER_ROW_PAD_PX = 8
/** The first fixture prompt, the newest session, which leads the Sessions list. */
const NEWEST_SESSION_TITLE = 'Stop retrying 4xx uploads'

const written = new WeakMap<Page, Promise<void>>()

function writeSessionsOnce(context: CaptureContext) {
  const existing = written.get(context.page)
  if (existing) return existing
  const next = writeUsageCostSessions({ ...context, now: new Date() })
  written.set(context.page, next)
  return next
}

function usageButton(page: Page) {
  return page.locator('[data-qa="sidebar-usage-cost"]')
}

async function openUsagePage(context: CaptureContext) {
  const { page } = context
  await writeSessionsOnce(context)
  await usageButton(page).click()
  await page
    .getByRole('heading', { name: 'Usage & Cost', exact: true })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await page.getByText(NEWEST_SESSION_TITLE).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
}

async function leaveUsagePage(page: Page) {
  await page.getByRole('button', { name: 'Back to app' }).first().click()
  await waitForUi(page)
}

/**
 * The page from its title down: the summary cards, Daily spending, By model, By project, and
 * the first rows of Sessions.
 */
export async function captureUsageCostPage(context: CaptureContext) {
  const { page } = context
  await withWindowSize(context, USAGE_WINDOW, async () => {
    await openUsagePage(context)
    const title = page.getByRole('heading', { name: 'Usage & Cost', exact: true })
    const sessions = page.getByRole('list').filter({ hasText: NEWEST_SESSION_TITLE }).last()
    const lastRow = sessions.locator('li').nth(SESSION_ROWS_SHOWN - 1)
    await shootRegion(
      context,
      'usage-cost-page.png',
      async () => {
        const heading = await regionOf(title)
        const list = await regionOf(sessions)
        const row = await regionOf(lastRow)
        const left = heading.x - CROP_MARGIN_PX
        const top = heading.y - CROP_MARGIN_PX
        return {
          x: left,
          y: top,
          width: list.x + list.width + CROP_MARGIN_PX - left,
          height: row.y + row.height - top,
        }
      },
      { hideScrollbars: true },
    )
    await leaveUsagePage(page)
  })
}

/** The sidebar's footer row: Settings, and Usage & Cost at its right edge, outlined. */
export async function captureUsageCostSidebarButton(context: CaptureContext) {
  const { page } = context
  const button = usageButton(page)
  const settings = page.locator('[data-qa="sidebar-settings"]')
  const row = button.locator('xpath=..')
  const rowBox = await regionOf(row)
  const buttonBox = await regionOf(button)
  await shootRegion(
    context,
    'usage-cost-sidebar-button.png',
    unionRegion([rowBox, await regionOf(settings)], { x: 0, y: FOOTER_ROW_PAD_PX }),
    { outline: buttonBox },
  )
}
