import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { OpenWaggleApi } from '@shared/types/ipc'
import { launchOpenWaggleElectron } from './playwright-electron-launcher'
import {
  PROJECT_NAME,
  seedMarketingSession,
  THREAD_LIST_MATCHER,
  THREAD_TITLE,
} from './website-screenshot-fixture'

declare global {
  interface Window {
    readonly api: OpenWaggleApi
  }
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCREENSHOT_OUTPUT_DIR = path.join(ROOT_DIR, 'website', 'public', 'screenshots')
const WINDOW_WIDTH_PX = 1600
const WINDOW_HEIGHT_PX = 1000
const UI_SETTLE_DELAY_MS = 350
const HERO_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'hero-screenshot.png')
const CODING_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-coding-agent.png')
const GIT_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-git-workflow.png')
const EXTENSIBLE_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-extensible.png')
const SESSION_TREE_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'session-tree-panel.png')

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  console.info('[website-shots] launching app')
  const app = await launchOpenWaggleElectron({
    cwd: ROOT_DIR,
    userDataDir,
    hidden: true,
  })
  const page = await app.firstWindow()

  await app.evaluate(
    async ({ BrowserWindow }, { width, height }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setBounds({ width, height })
    },
    { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX },
  )

  await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
  console.info('[website-shots] app ready')
  return { app, page }
}

async function restartApp(currentApp: ElectronApplication, userDataDir: string) {
  await currentApp.close()
  return launchApp(userDataDir)
}

async function configureProject(page: Page, projectPath: string) {
  console.info('[website-shots] configuring project path', projectPath)
  await page.evaluate(
    async ({ nextProjectPath, projectName }) => {
      await window.api.updateSettings({
        projectPath: nextProjectPath,
        recentProjects: [nextProjectPath],
        projectDisplayNames: {
          [nextProjectPath]: projectName,
        },
      })
    },
    { nextProjectPath: projectPath, projectName: PROJECT_NAME },
  )
}

async function createProjectAlias(userDataDir: string) {
  const projectLinksDir = path.join(userDataDir, 'projects')
  const aliasedProjectPath = path.join(projectLinksDir, PROJECT_NAME)
  await fs.mkdir(projectLinksDir, { recursive: true })
  await fs.rm(aliasedProjectPath, { recursive: true, force: true }).catch(() => undefined)
  await fs.symlink(ROOT_DIR, aliasedProjectPath, 'dir')
  return aliasedProjectPath
}

async function waitForUi(page: Page) {
  await page.waitForTimeout(UI_SETTLE_DELAY_MS)
}

async function openThread(page: Page, threadTitle: string) {
  console.info('[website-shots] opening thread', threadTitle)
  const thread = page.getByText(THREAD_LIST_MATCHER).first()
  await thread.waitFor()
  await thread.click()
  await waitForUi(page)
}

async function captureHeroScreenshot(page: Page) {
  console.info('[website-shots] capturing hero screenshot')
  await page.getByRole('button', { name: 'New session' }).first().click()
  await waitForUi(page)
  await page.locator('header').click()
  await waitForUi(page)
  await page.screenshot({ path: HERO_SCREENSHOT_PATH, animations: 'disabled', scale: 'css' })
}

async function captureCodingScreenshot(page: Page) {
  console.info('[website-shots] capturing coding screenshot')
  await openThread(page, THREAD_TITLE)
  await page.screenshot({ path: CODING_SCREENSHOT_PATH, animations: 'disabled', scale: 'css' })
}

async function captureGitScreenshot(page: Page) {
  console.info('[website-shots] capturing git screenshot')
  await openThread(page, THREAD_TITLE)
  await page.getByRole('button', { name: 'Toggle diff panel' }).click()
  await page.getByRole('button', { name: /Stage all/ }).waitFor()
  await waitForUi(page)
  await page.screenshot({ path: GIT_SCREENSHOT_PATH, animations: 'disabled', scale: 'css' })
}

async function captureExtensibleScreenshot(page: Page) {
  console.info('[website-shots] capturing extensibility screenshot')
  // MCP lives in Settings now, reached through the settings nav rather than a top-level button.
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'MCP' }).first().click()
  await waitForUi(page)
  await page.screenshot({ path: EXTENSIBLE_SCREENSHOT_PATH, animations: 'disabled', scale: 'css' })
}

/**
 * The Session Tree panel, used by the session-tree documentation page.
 *
 * Captured here rather than by hand so all five images are reproducible from one command and
 * cannot drift apart as the UI changes.
 */
async function captureSessionTreeScreenshot(page: Page) {
  console.info('[website-shots] capturing session tree screenshot')
  await openThread(page, THREAD_TITLE)
  await page.getByRole('button', { name: 'Toggle Session Tree' }).click()
  await page.getByRole('region', { name: 'Session Tree' }).waitFor()
  await waitForUi(page)
  await page.screenshot({ path: SESSION_TREE_SCREENSHOT_PATH, animations: 'disabled', scale: 'css' })
  await page.getByRole('button', { name: 'Toggle Session Tree' }).click()
  await waitForUi(page)
}

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-website-shots-'))
  const projectPath = await createProjectAlias(userDataDir)
  await fs.mkdir(SCREENSHOT_OUTPUT_DIR, { recursive: true })

  let currentApp: ElectronApplication | null = null

  try {
    let launched = await launchApp(userDataDir)
    currentApp = launched.app

    await configureProject(launched.page, projectPath)
    await seedMarketingSession(userDataDir, projectPath)

    console.info('[website-shots] restarting app to pick up seeded state')
    launched = await restartApp(launched.app, userDataDir)
    currentApp = launched.app

    await captureHeroScreenshot(launched.page)
    await captureCodingScreenshot(launched.page)
    await captureGitScreenshot(launched.page)
    await captureSessionTreeScreenshot(launched.page)
    await captureExtensibleScreenshot(launched.page)
    console.info('[website-shots] screenshot capture complete')
  } finally {
    await currentApp?.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
