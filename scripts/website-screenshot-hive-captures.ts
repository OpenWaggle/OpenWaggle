import type { Page } from '@playwright/test'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import { HIVE_NESTED_WORKER_TITLE, HIVE_QUEEN_TITLE } from './website-screenshot-hive-fixture'
import { SCREENSHOT_WORKTREE_IDS } from './website-screenshot-project'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  setSessionSummary,
  shoot,
  showRailSurface,
  waitForUi,
} from './website-screenshot-ui'

const UI_TIMEOUT_MS = 30_000

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
  await hivePanel(page).getByText(HIVE_NESTED_WORKER_TITLE).first().waitFor({ timeout: UI_TIMEOUT_MS })
}

/** The Hive panel's default tree: every Session from the Queen down, at any depth (#377). */
export async function captureHiveTree(context: CaptureContext) {
  await openQueenHive(context.page)
  await setHiveView(context.page, false)
  await shoot(context, 'hive-sessions.png')
}

/** The same Hive grouped by who acts next (ADR 0059). */
export async function captureHiveNextActor(context: CaptureContext) {
  await openQueenHive(context.page)
  await setHiveView(context.page, true)
  await hivePanel(context.page).getByText('Needs you').first().waitFor({ timeout: UI_TIMEOUT_MS })
  await shoot(context, 'hive-next-actor.png')
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
  await shoot(context, 'session-summary.png')
}

/** Sources & outputs: the Resource Browser the Summary's Show all opens. */
export async function captureSessionResources(context: CaptureContext) {
  await openSession(context.page, HIVE_QUEEN_TITLE)
  await showRailSurface(context.page, 'Resources')
  await context.page.getByRole('heading', { name: 'Sources & outputs' }).waitFor({ timeout: UI_TIMEOUT_MS })
  await shoot(context, 'session-resources.png')
  await closeRightPanel(context.page)
}

/** The Right panel's Scheduled surface for the Queen's project. */
export async function captureScheduledTasks(context: CaptureContext) {
  await openSession(context.page, HIVE_QUEEN_TITLE)
  await showRailSurface(context.page, 'Scheduled')
  await shoot(context, 'scheduled-tasks.png')
  await closeRightPanel(context.page)
}

/** Settings > Worktrees with the project's managed worktrees and the Sessions that own them. */
export async function captureSettingsWorktrees(context: CaptureContext) {
  const { page } = context
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'Worktrees' }).first().click()
  await page.getByText(sessionWorktreeBranchForId(SCREENSHOT_WORKTREE_IDS[0])).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await shoot(context, 'settings-worktrees.png')
  await page.getByRole('button', { name: 'Back to app' }).first().click()
  await waitForUi(page)
}
