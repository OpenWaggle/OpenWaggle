import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { WebsiteScreenshot } from './website-screenshot-manifest'

const UI_SETTLE_DELAY_MS = 400
const GIT_READY_TIMEOUT_MS = 120_000
const UI_TIMEOUT_MS = 30_000

export interface CaptureContext {
  readonly app: ElectronApplication
  readonly page: Page
  readonly outputDir: string
  readonly evidenceDir: string
}

export async function waitForUi(page: Page) {
  await page.waitForTimeout(UI_SETTLE_DELAY_MS)
}

/** Writes the website image, and a copy beside the run's other QA evidence. */
export async function shoot(context: CaptureContext, file: WebsiteScreenshot) {
  const target = path.join(context.outputDir, file)
  // Park the pointer in a corner so no hover state or tooltip lands in the image.
  await context.page.mouse.move(1, 1)
  await blurFocusedControl(context.page)
  await context.page.screenshot({ path: target, animations: 'disabled', scale: 'css' })
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}

export async function waitForGitStatus(page: Page) {
  // The header's Changes button carries the Session's Git status state.
  const changes = page.locator('header [data-git-status-state]')
  await changes.waitFor({ timeout: GIT_READY_TIMEOUT_MS })
  await expect(changes).toHaveAttribute('data-git-status-state', 'ready', {
    timeout: GIT_READY_TIMEOUT_MS,
  })
}

/** Opens a sidebar Session by its exact title and waits for its header. */
export async function openSession(page: Page, title: string) {
  console.info('[website-shots] opening session', title)
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
  await sidebar.getByRole('button', { name: title, exact: true }).first().click()
  await page.locator('header').getByText(title, { exact: true }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await blurFocusedControl(page)
}

/**
 * A clicked sidebar row keeps focus, which shows its row actions; and Chromium paints a focus
 * ring on it after the next key press. Neither belongs in a screenshot.
 */
export async function blurFocusedControl(page: Page) {
  await page.evaluate(() => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement) focused.blur()
  })
  await waitForUi(page)
}

function panelRail(page: Page) {
  return page.getByRole('navigation', { name: 'Panels' })
}

/** Shows one Right panel surface from the Panel rail; its label starts with the surface title. */
export async function showRailSurface(page: Page, title: string) {
  const button = panelRail(page).getByRole('button', { name: new RegExp(`^${title}\\b`) })
  await button.waitFor({ timeout: UI_TIMEOUT_MS })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await waitForUi(page)
}

export async function closeRightPanel(page: Page) {
  const pressed = panelRail(page).locator('button[aria-pressed="true"]')
  if ((await pressed.count()) > 0) await pressed.first().click()
  await waitForUi(page)
}

export async function setSessionSummary(page: Page, open: boolean) {
  const toggle = page.getByRole('button', { name: /^(Open|Hide) Session Summary$/ })
  await toggle.waitFor({ timeout: UI_TIMEOUT_MS })
  const isOpen = (await toggle.getAttribute('aria-label')) === 'Hide Session Summary'
  if (isOpen !== open) await toggle.click()
  const summary = page.getByRole('complementary', { name: 'Session Summary' })
  if (open) await summary.waitFor({ timeout: UI_TIMEOUT_MS })
  else await summary.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
}

/** Records the page's accessible structure and pixels when a capture fails, for diagnosis. */
export async function recordFailureEvidence(context: CaptureContext, name: string) {
  const prefix = path.join(context.evidenceDir, `failed-${name}`)
  await context.page.screenshot({ path: `${prefix}.png`, scale: 'css' }).catch(() => undefined)
  const snapshot = await context.page
    .locator('body')
    .ariaSnapshot()
    .catch((error: unknown) => String(error))
  await fs.writeFile(`${prefix}.aria.yml`, snapshot, 'utf8')
  console.error(`[website-shots] ${name} failed; evidence at ${prefix}.png and ${prefix}.aria.yml`)
}
