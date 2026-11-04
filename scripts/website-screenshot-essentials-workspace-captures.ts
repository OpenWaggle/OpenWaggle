import type { Page } from '@playwright/test'
import { regionOf, shootRegion, unionRegion } from './website-screenshot-capture-kit'
import { TOOL_ROWS_SESSION_TITLE } from './website-screenshot-essentials-fixture'
import {
  CROP_PAD_PX,
  GIT_READY_TIMEOUT_MS,
  prepareEssentials,
} from './website-screenshot-essentials-setup'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  showRailSurface,
  waitForGitStatus,
  waitForUi,
  UI_TIMEOUT_MS,
} from './website-screenshot-ui'

/** The fixture change's added lines a review comment covers, and a second comment's line. */
const REVIEW_FIRST_LINE = 3
const REVIEW_LAST_LINE = 7
const REVIEW_SECOND_LINE = 24

/** The diff panel's lines in the gutter: the place a click opens a comment box. */
function diffGutterLine(page: Page, line: number) {
  return page
    .locator(
      `[data-gutter] [data-column-number="${String(line)}"][data-line-type="change-addition"]`,
    )
    .first()
}

/** The right panel over the conversation too, so diff lines are not cut off. */
async function setPanelMaximized(page: Page, maximized: boolean) {
  const toggle = page.getByRole('button', { name: 'Maximize panel' })
  if ((await toggle.getAttribute('aria-pressed')) !== String(maximized)) await toggle.click()
  await waitForUi(page)
}

async function openChanges(page: Page) {
  await showRailSurface(page, 'Changes')
  await setPanelMaximized(page, true)
  await diffGutterLine(page, REVIEW_FIRST_LINE).waitFor({ timeout: GIT_READY_TIMEOUT_MS })
  await waitForUi(page)
}

/**
 * A review in the diff panel: one comment saved to the review, so the bar shows 1 pending
 * comment, and a second comment box open with Add comment and Add to review.
 */
export async function captureDiffReviewComment(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSession(page, TOOL_ROWS_SESSION_TITLE)
  await openChanges(page)
  await diffGutterLine(page, REVIEW_FIRST_LINE).click()
  await page.keyboard.down('Shift')
  await diffGutterLine(page, REVIEW_LAST_LINE).click()
  await page.keyboard.up('Shift')
  const feedback = page.getByRole('textbox', { name: 'Leave feedback on this change…' })
  await feedback.fill(
    'Keep 429 out of this set: the API client already retries rate limits after Retry-After.',
  )
  await page.getByRole('button', { name: 'Start a review' }).click()
  await page.getByText('1 pending comment').waitFor({ timeout: UI_TIMEOUT_MS })
  await diffGutterLine(page, REVIEW_SECOND_LINE).click()
  await feedback.fill('Log the status we give up on, so these failures show up in Datadog.')
  const panel = page.getByRole('complementary').filter({ has: page.getByText('1 pending comment') })
  await shootRegion(context, 'diff-review-comment.png', () => regionOf(panel))
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Discard review' }).click()
  await setPanelMaximized(page, false)
  await closeRightPanel(page)
}

/** The commit dialog for the uncommitted change, with a message typed. */
export async function captureCommitDialog(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSession(page, TOOL_ROWS_SESSION_TITLE)
  await waitForGitStatus(page)
  await page.getByRole('button', { name: 'Open commit dialog' }).click()
  const dialog = page.getByRole('dialog', { name: 'Commit changes' })
  await dialog
    .getByRole('checkbox', { name: /src\/upload\/retry\.ts/ })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await dialog
    .getByRole('textbox', { name: 'Commit message' })
    .fill('fix(upload): stop retrying client errors')
  await shootRegion(context, 'commit-dialog.png', () => regionOf(dialog))
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
}

const projectActionsRegion = (page: Page) => page.getByRole('region', { name: 'Project actions' })

/** Runs a saved action from the panel and returns to the list from its output view. */
async function runAction(page: Page, name: string) {
  await projectActionsRegion(page)
    .getByRole('button', { name: `Run ${name}`, exact: true })
    .click()
  await page.getByRole('region', { name: 'Action output' }).waitFor({ timeout: UI_TIMEOUT_MS })
  await page.getByRole('button', { name: 'Back to Project Actions' }).click()
  await projectActionsRegion(page).waitFor({ timeout: UI_TIMEOUT_MS })
}

const actionRuns = new WeakMap<Page, Promise<void>>()

/** The dev server running, the lint failed and the build completed; the tests stay Ready. */
async function startActionRuns(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSession(page, TOOL_ROWS_SESSION_TITLE)
  await showRailSurface(page, 'Project Actions')
  const list = projectActionsRegion(page)
  await runAction(page, 'Build')
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Build' })
    .getByText('Completed')
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await runAction(page, 'Lint')
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Lint' })
    .getByText('Failed')
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await runAction(page, 'Dev server')
  await list
    .getByRole('listitem')
    .filter({ hasText: 'Dev server' })
    .getByText('Running')
    .waitFor({ timeout: UI_TIMEOUT_MS })
}

function ensureActionRuns(context: CaptureContext) {
  const existing = actionRuns.get(context.page)
  if (existing) return existing
  const next = startActionRuns(context)
  actionRuns.set(context.page, next)
  return next
}

async function showProjectActions(context: CaptureContext) {
  await ensureActionRuns(context)
  await openSession(context.page, TOOL_ROWS_SESSION_TITLE)
  await showRailSurface(context.page, 'Project Actions')
  await projectActionsRegion(context.page).waitFor({ timeout: UI_TIMEOUT_MS })
}

/** The Project Actions panel with four saved actions: Running, Ready, Failed and Completed. */
export async function captureProjectActionsPanel(context: CaptureContext) {
  const { page } = context
  await showProjectActions(context)
  const panel = page.getByRole('complementary').filter({ has: projectActionsRegion(page) })
  const addAction = projectActionsRegion(page).getByRole('button', { name: 'Add action' })
  const panelBox = await regionOf(panel)
  const addBox = await regionOf(addAction)
  await shootRegion(context, 'project-actions-panel.png', {
    ...panelBox,
    height: addBox.y + addBox.height + CROP_PAD_PX - panelBox.y,
  })
}

/** Add action: the panel's two questions and its optional settings, before anything is chosen. */
export async function captureProjectActionAdd(context: CaptureContext) {
  const { page } = context
  await showProjectActions(context)
  await projectActionsRegion(page).getByRole('button', { name: 'Add action' }).click()
  const form = page.getByRole('region', { name: 'New action' })
  await form.getByRole('list', { name: 'Project scripts' }).waitFor({ timeout: UI_TIMEOUT_MS })
  const panel = page.getByRole('complementary').filter({ has: form })
  await shootRegion(context, 'project-action-add.png', await regionOf(panel))
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
}

/** The dev server's output as a read-only tab in the terminal drawer. */
export async function captureActionOutputTerminal(context: CaptureContext) {
  const { page } = context
  await showProjectActions(context)
  await page.getByRole('button', { name: 'Open Dev server output in terminal' }).click()
  const output = page.getByRole('region', { name: 'Dev server · action output' })
  await output.waitFor({ timeout: UI_TIMEOUT_MS })
  await output.getByText('ready in', { exact: false }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  const tabs = page.getByRole('tablist', { name: 'Terminal tabs' })
  const outputBox = await regionOf(output)
  const tabsBox = await regionOf(tabs)
  const drawer = unionRegion([outputBox, { ...tabsBox, width: outputBox.width }])
  await shootRegion(context, 'action-output-terminal.png', drawer)
  await page.getByRole('button', { name: 'Close terminal panel' }).click()
  await closeRightPanel(page)
}
