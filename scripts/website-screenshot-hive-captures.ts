import type { Page } from '@playwright/test'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  shootSettingsContent,
  shootWindow,
  unionRegion,
} from './website-screenshot-capture-kit'
import { HIVE_NESTED_WORKER_TITLE, HIVE_QUEEN_TITLE } from './website-screenshot-hive-fixture'
import { SCREENSHOT_WORKTREE_IDS } from './website-screenshot-project'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  setSessionSummary,
  showRailSurface,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

/** Beside the Add a source menu, close enough to leave the conversation behind the Summary out. */
const SUMMARY_SIDE_PAD_PX = 8
const RESOURCES_TITLE_PAD_PX = 10
const WORKTREES_BOTTOM_PAD_PX = 32

function hivePanel(page: Page) {
  return page.getByRole('region', { name: 'Hive' })
}

async function setHiveView(page: Page, grouped: boolean) {
  const toggle = hivePanel(page).getByRole('button', { name: 'By next actor' })
  await toggle.waitFor({ timeout: UI_TIMEOUT_MS })
  if ((await toggle.getAttribute('aria-pressed')) !== String(grouped)) await toggle.click()
  await waitForUi(page)
}

async function openQueenHive(page: Page) {
  await openSession(page, HIVE_QUEEN_TITLE)
  await showRailSurface(page, 'Hive')
  await hivePanel(page)
    .getByText(HIVE_NESTED_WORKER_TITLE)
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
}

/** The Hive panel's default tree: every Session from the Queen down, at any depth (#377). */
export async function captureHiveTree(context: CaptureContext) {
  await openQueenHive(context.page)
  await setHiveView(context.page, false)
  await shootWindow(context, 'hive-sessions.png', { lossless: true })
}

/** The same Hive grouped by who acts next (ADR 0059). */
export async function captureHiveNextActor(context: CaptureContext) {
  await openQueenHive(context.page)
  await setHiveView(context.page, true)
  const panel = hivePanel(context.page)
  await panel.getByText('Needs you').first().waitFor({ timeout: UI_TIMEOUT_MS })
  // The panel alone, down to its Archived row; the conversation beside it is another page's.
  await shootRegion(context, 'hive-next-actor.png', async () => {
    const box = await regionOf(panel)
    const archived = await regionOf(panel.getByText(/^Archived ·/).first())
    return { ...box, height: archived.y + archived.height + CROP_MARGIN_PX - box.y }
  })
  await setHiveView(context.page, false)
  await closeRightPanel(context.page)
}

/** The Queen's Summary: Environment, Sources, Outputs, Scheduled and the Hive row. */
export async function captureSessionSummary(context: CaptureContext) {
  await openSession(context.page, HIVE_QUEEN_TITLE)
  await closeRightPanel(context.page)
  await setSessionSummary(context.page, true)
  const summary = context.page.getByRole('complementary', { name: 'Session Summary' })
  const outputs = summary.getByRole('button', { name: /^Outputs/ }).first()
  await outputs.waitFor({ timeout: UI_TIMEOUT_MS })
  if ((await outputs.getAttribute('aria-expanded')) === 'false') await outputs.click()
  await summary.getByRole('region', { name: 'Outputs list' }).waitFor({ timeout: UI_TIMEOUT_MS })
  // The Summary card alone: it sits over the panel's right side, which a wider margin would show.
  await shootRegion(context, 'session-summary.png', async () => regionOf(summary))
}

/**
 * The Summary's Sources section with its Add a source menu open (Attach files, Reference
 * project file). No outline: the menu opens over the Summary's other rows, and an outline's
 * margin would show a cut line of them above it.
 */
export async function captureSessionSummaryAddSource(context: CaptureContext) {
  const { page } = context
  await openSession(page, HIVE_QUEEN_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, true)
  const summary = page.getByRole('complementary', { name: 'Session Summary' })
  const add = summary.getByRole('button', { name: 'Add a source', exact: true })
  await add.click()
  const menu = page.getByRole('menu').filter({ hasText: 'Reference project file' })
  await menu.waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  const menuBox = await regionOf(menu)
  const sources = summary.getByRole('button', { name: /^Sources/ }).first()
  // Starting at the menu's top edge, and close at the sides so the conversation behind the
  // Summary stays out.
  const box = unionRegion([menuBox, await regionOf(sources), await regionOf(add)], {
    x: SUMMARY_SIDE_PAD_PX,
    y: 0,
  })
  const card = await regionOf(summary)
  await shootRegion(
    context,
    'session-summary-add-source.png',
    { ...box, height: Math.max(box.height, card.y + card.height + SUMMARY_SIDE_PAD_PX - box.y) },
    { keepFocus: true },
  )
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  await setSessionSummary(page, false)
}

/** Sources & outputs on its own: Sources and Outputs, and the Queen's resources by type. */
export async function captureSessionResourcesBrowser(context: CaptureContext) {
  const { page } = context
  await openSession(page, HIVE_QUEEN_TITLE)
  await showRailSurface(page, 'Resources')
  const heading = page.getByRole('heading', { name: 'Sources & outputs' })
  await heading.waitFor({ timeout: UI_TIMEOUT_MS })
  const browser = page.getByRole('region', { name: 'Session resources' })
  await browser.getByText('README.md').first().waitFor({ timeout: UI_TIMEOUT_MS })
  // From the panel's title to its last resource; the empty panel below adds nothing.
  await shootRegion(context, 'session-resources-browser.png', async () => {
    const panel = await regionOf(browser)
    // Below the window header's border line, which sits just above the panel's title row.
    const top = (await regionOf(heading)).y - RESOURCES_TITLE_PAD_PX
    const rows = browser.locator('section[aria-labelledby^="session-resource-group-"]')
    const last = await regionOf(rows.last())
    return { ...panel, y: top, height: last.y + last.height + CROP_MARGIN_PX - top }
  })
  await closeRightPanel(page)
}

/** The Right panel's Scheduled surface for the Queen's project, from its title to its last line. */
export async function captureScheduledTasks(context: CaptureContext) {
  const { page } = context
  await openSession(page, HIVE_QUEEN_TITLE)
  await showRailSurface(page, 'Scheduled')
  const footer = page.getByText(/^Tasks in other projects are in/).first()
  await footer.waitFor({ timeout: UI_TIMEOUT_MS })
  // The innermost element holding both the panel's close button and its footer is the panel.
  const panel = page
    .locator(
      'xpath=//*[.//button[@aria-label="Close side panel"] and .//*[starts-with(normalize-space(), "Tasks in other projects")]]',
    )
    .last()
  await shootRegion(context, 'scheduled-tasks.png', async () => {
    const box = await regionOf(panel)
    const footerBox = await regionOf(footer)
    return { ...box, height: footerBox.y + footerBox.height + CROP_MARGIN_PX - box.y }
  })

  await closeRightPanel(context.page)
}

/**
 * Settings > Worktrees: storage, Automatic cleanup, and the project's managed worktrees with the
 * Sessions that own them. Their Sessions are open, so they are In use, which starts collapsed.
 */
export async function captureSettingsWorktrees(context: CaptureContext) {
  const { page } = context
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'Worktrees' }).first().click()
  await page
    .getByRole('button', { name: /^In use/ })
    .first()
    .click({ timeout: UI_TIMEOUT_MS })
  await page
    .getByText(sessionWorktreeBranchForId(SCREENSHOT_WORKTREE_IDS[0]))
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  // The Worktrees page beside the section list, down to its last worktree.
  const lastRow = await regionOf(page.getByText(/^A Session that is not archived uses it/).last())
  await shootSettingsContent(
    context,
    'settings-worktrees.png',
    lastRow.y + lastRow.height + WORKTREES_BOTTOM_PAD_PX,
  )
  await page.getByRole('button', { name: 'Back to app' }).first().click()
  await waitForUi(page)
}
