import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { OpenWaggleApi } from '@shared/types/ipc'
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
const E2E_ENV_KEYS: readonly string[] = [
  'CI',
  'COLORTERM',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
] as const

const HERO_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'hero-screenshot.png')
const CODING_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-coding-agent.png')
const GIT_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-git-workflow.png')
const EXTENSIBLE_SCREENSHOT_PATH = path.join(SCREENSHOT_OUTPUT_DIR, 'feature-extensible.png')

function buildElectronEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {
    OPENWAGGLE_USER_DATA_DIR: userDataDir,
  }

  for (const key of E2E_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }

  return env
}

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  console.info('[website-shots] launching app')
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT_DIR,
    env: buildElectronEnv(userDataDir),
  })
  const page = await app.firstWindow()

  await app.evaluate(
    async ({ BrowserWindow }, { width, height }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setBounds({ width, height })
    },
    { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX },
  )

  await expect(page.getByRole('button', { name: 'New thread' }).first()).toBeVisible()
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
  await page.getByRole('button', { name: 'New thread' }).first().click()
  await waitForUi(page)
  await page.locator('header').click()
  await waitForUi(page)
  await page.screenshot({ path: HERO_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureCodingScreenshot(page: Page) {
  console.info('[website-shots] capturing coding screenshot')
  await openThread(page, THREAD_TITLE)
  await page.screenshot({ path: CODING_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureGitScreenshot(page: Page) {
  console.info('[website-shots] capturing git screenshot')
  await openThread(page, THREAD_TITLE)
  await page.getByRole('button', { name: 'Toggle diff panel' }).click()
  await page.getByRole('button', { name: /Stage all/ }).waitFor()
  await waitForUi(page)
  await page.screenshot({ path: GIT_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureExtensibleScreenshot(page: Page) {
  console.info('[website-shots] capturing extensibility screenshot')
  await page.getByRole('button', { name: 'MCPs' }).click()
  await page.getByRole('heading', { name: 'MCPs' }).waitFor()
  await page.getByText('Registry').waitFor()
  await waitForUi(page)
  await page.screenshot({ path: EXTENSIBLE_SCREENSHOT_PATH, animations: 'disabled' })
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
