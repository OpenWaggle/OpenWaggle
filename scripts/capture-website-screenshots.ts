import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { stopElectronQaSessionHost } from './electron-qa-shutdown'
import { launchOpenWaggleElectron } from './playwright-electron-launcher'
import {
  captureCodingAgent,
  captureGitWorkflow,
  captureSessionTree,
} from './website-screenshot-conversation-captures'
import { captureBrowserPreview } from './website-screenshot-browser-capture'
import {
  PROJECT_NAME,
  seedBrowserSession,
  seedMarketingSession,
} from './website-screenshot-fixture'
import {
  captureHiveNextActor,
  captureHiveTree,
  captureScheduledTasks,
  captureSessionResources,
  captureSessionSummary,
  captureSettingsWorktrees,
} from './website-screenshot-hive-captures'
import { seedHiveExample } from './website-screenshot-hive-fixture'
import { selectedScreenshots, type WebsiteScreenshot } from './website-screenshot-manifest'
import { createScreenshotProject, type ScreenshotProject } from './website-screenshot-project'
import { createScheduledTasks, scheduledTaskFixtures } from './website-screenshot-scheduled-tasks'
import { type CaptureContext, recordFailureEvidence } from './website-screenshot-ui'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCREENSHOT_OUTPUT_DIR = path.join(ROOT_DIR, 'website', 'public', 'screenshots')
const WINDOW_WIDTH_PX = 1600
const WINDOW_HEIGHT_PX = 1000
/** Fixed ids, so the worktree paths and branches read the same in every capture. */
const POSIX_TEMP_DIR = '/tmp'
/** `node` and the script path come before the user's arguments. */
const USER_ARGUMENT_OFFSET = 2
const WORKTREE_IDS = ['3f9c2a1e', '7b41d0c8'] as const

const CAPTURES: Readonly<Record<WebsiteScreenshot, (context: CaptureContext) => Promise<void>>> = {
  'hive-sessions.png': captureHiveTree,
  'hive-next-actor.png': captureHiveNextActor,
  'session-summary.png': captureSessionSummary,
  'session-resources.png': captureSessionResources,
  'scheduled-tasks.png': captureScheduledTasks,
  'settings-worktrees.png': captureSettingsWorktrees,
  'feature-coding-agent.png': captureCodingAgent,
  'feature-git-workflow.png': captureGitWorkflow,
  'session-tree-panel.png': captureSessionTree,
  'feature-browser-preview.png': captureBrowserPreview,
}

interface ScratchProfile {
  readonly root: string
  readonly userDataDir: string
  readonly homeDir: string
}

async function launchApp(profile: ScratchProfile, projectPath: string) {
  console.info('[website-shots] launching the built app, hidden')
  const app = await launchOpenWaggleElectron({
    cwd: projectPath,
    appPath: ROOT_DIR,
    userDataDir: profile.userDataDir,
    homeDir: profile.homeDir,
    hidden: true,
  })
  const page = await app.firstWindow()
  await app.evaluate(
    async ({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width, height })
    },
    { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX },
  )
  await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
  const runtime = await page.evaluate(() => ({
    hasApi: typeof window.api.getSessionDetail === 'function',
    isElectron: navigator.userAgent.includes('Electron'),
  }))
  if (!runtime.hasApi || !runtime.isElectron) {
    throw new Error('Screenshot capture did not reach the Electron app with its preload API.')
  }
  return { app, page }
}

async function configureProject(page: Page, projectPath: string) {
  await page.evaluate(
    async ({ nextProjectPath, projectName }) => {
      await window.api.updateSettings({
        projectPath: nextProjectPath,
        recentProjects: [nextProjectPath],
        projectDisplayNames: { [nextProjectPath]: projectName },
      })
    },
    { nextProjectPath: projectPath, projectName: PROJECT_NAME },
  )
}

/** Seeds the Host database the first launch created, then restarts so the GUI reads it fresh. */
async function launchSeededApp(profile: ScratchProfile, project: ScreenshotProject) {
  const first = await launchApp(profile, project.projectPath)
  await configureProject(first.page, project.projectPath)
  await seedMarketingSession(profile.userDataDir, project.projectPath)
  await seedBrowserSession(profile.userDataDir, project.projectPath)
  const hive = await seedHiveExample(profile.userDataDir, project)
  await first.app.close()
  const launched = await launchApp(profile, project.projectPath)
  await createScheduledTasks(
    launched.page,
    scheduledTaskFixtures({
      queenSessionId: hive.queenSessionId,
      projectPath: project.projectPath,
      now: new Date(),
    }),
  )
  await launched.page.reload()
  await expect(launched.page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
  return launched
}

function observeRendererErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/**
 * The scratch profile's parent. Its path shows in Settings > Worktrees and the Hive, so it uses
 * the plain system temporary directory rather than an agent's long per-Session scratch path.
 */
function scratchBase() {
  return process.platform === 'win32' ? os.tmpdir() : POSIX_TEMP_DIR
}

async function evidenceDirectory() {
  const base = process.env.OPENWAGGLE_EVIDENCE_DIR
  if (base) {
    const directory = path.join(base, `website-screenshots-${Date.now()}`)
    await fs.mkdir(directory, { recursive: true })
    return directory
  }
  return fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-website-shots-evidence-'))
}

async function runCaptures(context: CaptureContext, screenshots: readonly WebsiteScreenshot[]) {
  for (const screenshot of screenshots) {
    try {
      await CAPTURES[screenshot](context)
    } catch (error) {
      await recordFailureEvidence(context, screenshot.replace(/\.png$/, ''))
      throw error
    }
  }
}

async function main() {
  const screenshots = selectedScreenshots(process.argv.slice(USER_ARGUMENT_OFFSET))
  const root = await fs.realpath(await fs.mkdtemp(path.join(scratchBase(), 'openwaggle-shots-')))
  const profile = {
    root,
    userDataDir: path.join(root, 'user-data'),
    homeDir: path.join(root, 'home'),
  }
  const evidenceDir = await evidenceDirectory()
  console.info('[website-shots] scratch profile', root)
  console.info('[website-shots] evidence', evidenceDir)
  await fs.mkdir(SCREENSHOT_OUTPUT_DIR, { recursive: true })
  let app: ElectronApplication | null = null
  try {
    const project = await createScreenshotProject({
      rootDir: ROOT_DIR,
      projectPath: path.join(root, PROJECT_NAME),
      homeDir: profile.homeDir,
      worktreeIds: WORKTREE_IDS,
    })
    const launched = await launchSeededApp(profile, project)
    app = launched.app
    const rendererErrors = observeRendererErrors(launched.page)
    await runCaptures(
      { app, page: launched.page, outputDir: SCREENSHOT_OUTPUT_DIR, evidenceDir },
      screenshots,
    )
    if (rendererErrors.length > 0) {
      throw new Error(`Screenshot capture saw renderer errors: ${rendererErrors.join(' | ')}`)
    }
    console.info('[website-shots] screenshot capture complete')
  } finally {
    await app?.close().catch(() => undefined)
    // The Session Host is detached from the GUI and would keep the profile's SQLite files open.
    await stopElectronQaSessionHost(profile.userDataDir).catch((error: unknown) => {
      console.error('[website-shots] Session Host shutdown failed', error)
      process.exitCode = 1
    })
    await fs.rm(root, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)
  process.exitCode = 1
})
