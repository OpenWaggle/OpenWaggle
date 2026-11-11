import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import type { OpenWaggleApi } from '@shared/types/ipc'
import type { ConnectedElectrobunApp } from './support/electrobun-app-launch'
import type { FixtureModelServer } from './website-screenshot-model-server'

const UI_SETTLE_DELAY_MS = 400
/** Worktree creation, git status and the source control host check can each take a while. */
export const GIT_READY_TIMEOUT_MS = 120_000
export const UI_TIMEOUT_MS = 30_000
/** The window every capture starts and ends in. */
export const WINDOW_SIZE = { width: 1600, height: 1000 } as const

declare global {
  interface Window {
    readonly api: OpenWaggleApi
  }
}

export interface CaptureContext {
  readonly app: ConnectedElectrobunApp
  readonly page: Page
  readonly outputDir: string
  readonly evidenceDir: string
  /** The scratch profile's HOME, which the launcher forces on the app; fixtures write only here. */
  readonly homeDir: string
  /** The scratch profile's userData directory, which holds the Host database. */
  readonly userDataDir: string
  /** The scripted model every real Run talks to. */
  readonly model: FixtureModelServer
  /**
   * Seeds the feature Sessions into the running app's Host database the first time it is called
   * and resolves true then (the caller reloads), false afterwards. They wait for the first capture
   * that needs them, so the older captures keep their sidebars unchanged.
   */
  readonly seedFeatureSessionsOnce: () => Promise<boolean>
}

export async function waitForUi(page: Page) {
  await page.waitForTimeout(UI_SETTLE_DELAY_MS)
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
  await page
    .locator('header')
    .getByText(title, { exact: true })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await blurFocusedControl(page)
  await hideDockedSessionSummary(page)
}

/**
 * The Session Summary docks by default and moves the conversation aside (ADR 0026 amendment).
 * Captures of the conversation predate that and show it full width, so a Session opens with its
 * Summary hidden; a capture that shows the Summary opens it with setSessionSummary.
 */
async function hideDockedSessionSummary(page: Page) {
  const hide = page.getByRole('button', { name: 'Hide Session Summary', exact: true })
  if ((await hide.count()) === 0) return
  await hide.click()
  await page
    .getByRole('complementary', { name: 'Session Summary' })
    .waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
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

interface WindowSize {
  readonly width: number
  readonly height: number
}

/**
 * Sizes the renderer's viewport over CDP. The window is hidden, so its own frame never shows, and
 * the renderer lays out (and reports native preview bounds) for the emulated size.
 */
export async function setWindowSize(page: Page, size: WindowSize) {
  await page.setViewportSize(size)
  await page.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    size,
  )
  await waitForUi(page)
}

/** Runs a capture at another window size, then restores the standard one. */
export async function withWindowSize<T>(
  context: CaptureContext,
  size: WindowSize,
  capture: () => Promise<T>,
) {
  await setWindowSize(context.page, size)
  try {
    return await capture()
  } finally {
    await setWindowSize(context.page, WINDOW_SIZE)
  }
}

/**
 * Opens a Settings section, from the app or from another section, and waits for `heading` when
 * given (a section's heading is not always its name: Shortcuts says Keyboard shortcuts).
 */
export async function openSettingsSection(page: Page, section: string, heading?: string) {
  const back = page.getByRole('button', { name: 'Back to app' }).first()
  if (!(await back.isVisible())) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  }
  await page.getByRole('button', { name: section, exact: true }).first().click()
  if (heading) {
    await page
      .getByRole('heading', { name: heading, exact: true })
      .first()
      .waitFor({ timeout: UI_TIMEOUT_MS })
  }
  await waitForUi(page)
}

/** Back to the app, when Settings is open. */
export async function leaveSettings(page: Page) {
  const back = page.getByRole('button', { name: 'Back to app' }).first()
  if (await back.isVisible()) await back.click()
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
