import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { stopQaProfileSessionHost } from './qa/session-host-shutdown'
import {
  type ConnectedElectrobunApp,
  launchElectrobunApp,
  resolveElectrobunLauncher,
} from './support/electrobun-app-launch'
import { CAPTURES } from './website-screenshot-captures'
import { MODEL_SCENARIOS } from './website-screenshot-essentials-scenarios'
import { settleEssentials } from './website-screenshot-essentials-setup'
import { addFeatureProjectFiles } from './website-screenshot-feature-fixture'
import { featureSessionSeeder } from './website-screenshot-feature-sessions'
import {
  PROJECT_NAME,
  seedBrowserSession,
  seedMarketingSession,
} from './website-screenshot-fixture'
import { seedHiveExample } from './website-screenshot-hive-fixture'
import {
  publishScreenshots,
  selectedScreenshots,
  type WebsiteScreenshot,
} from './website-screenshot-manifest'
import { type FixtureModelServer, startFixtureModelServer } from './website-screenshot-model-server'
import { writeFixturePiAgent } from './website-screenshot-pi-agent'
import {
  createScreenshotProject,
  SCREENSHOT_WORKTREE_IDS,
  type ScreenshotProject,
} from './website-screenshot-project'
import { createScheduledTasks, scheduledTaskFixtures } from './website-screenshot-scheduled-tasks'
import {
  type CaptureContext,
  recordFailureEvidence,
  setWindowSize,
  WINDOW_SIZE,
} from './website-screenshot-ui'
import { WAGGLE_SCENARIO } from './website-screenshot-waggle-captures'
import { scriptEnv } from './support/env'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCREENSHOT_OUTPUT_DIR = path.join(ROOT_DIR, 'website', 'public', 'screenshots')
/** The scratch profile's parent on macOS and Linux: its short paths show in Settings > Worktrees. */
const POSIX_TEMP_DIR = '/tmp'
/** `node` and the script path come before the user's arguments. */
const USER_ARGUMENT_OFFSET = 2
const APP_FLAG = '--app'

interface ScratchProfile {
  readonly root: string
  readonly userDataDir: string
  readonly homeDir: string
}

async function launchApp(launcher: string, profile: ScratchProfile, projectPath: string) {
  console.info('[website-shots] launching the packaged app, hidden')
  const app = await launchElectrobunApp({
    launcher,
    cwd: projectPath,
    userDataDir: profile.userDataDir,
    homeDir: profile.homeDir,
  })
  const page = await closingOnFailure(app, async () => {
    await setWindowSize(app.page, WINDOW_SIZE)
    await expect(app.page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
    const hasApi = await app.page.evaluate(() => typeof window.api.getSessionDetail === 'function')
    if (!hasApi) throw new Error('Screenshot capture reached a renderer without the preload API.')
    return app.page
  })
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

/**
 * Runs `step` with a launched app and closes the app if the step throws, so `main()`'s `finally`
 * never stops the Session Host while an app it does not know about could start another one.
 */
async function closingOnFailure<T>(app: ConnectedElectrobunApp, step: () => Promise<T>) {
  try {
    return await step()
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

/** Seeds the Host database the first launch created, then restarts so the GUI reads it fresh. */
async function launchSeededApp(
  launcher: string,
  profile: ScratchProfile,
  project: ScreenshotProject,
) {
  const first = await launchApp(launcher, profile, project.projectPath)
  const hive = await closingOnFailure(first.app, async () => {
    await configureProject(first.page, project.projectPath)
    await seedMarketingSession(profile.userDataDir, project.projectPath)
    await seedBrowserSession(profile.userDataDir, project.projectPath)
    return seedHiveExample(profile.userDataDir, project)
  })
  await first.app.close()
  const launched = await launchApp(launcher, profile, project.projectPath)
  await closingOnFailure(launched.app, async () => {
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
  })
  const seedFeatureSessionsOnce = featureSessionSeeder({
    userDataDir: profile.userDataDir,
    project,
    homeDir: profile.homeDir,
  })
  return { ...launched, seedFeatureSessionsOnce }
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
  const base = scriptEnv().OPENWAGGLE_EVIDENCE_DIR
  if (base) {
    const directory = path.join(base, `website-screenshots-${Date.now()}`)
    await fs.mkdir(directory, { recursive: true })
    return directory
  }
  return fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-website-shots-evidence-'))
}

/** `--app <path>` picks the app; without it, the build `bun run package:app` left in `out/`. */
function appLauncher() {
  const index = process.argv.indexOf(APP_FLAG)
  return resolveElectrobunLauncher(index === -1 ? undefined : process.argv[index + 1])
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
  // Captures land here first and replace the website's images only when every one succeeded.
  const stagingDir = path.join(root, 'screenshots')
  await fs.mkdir(stagingDir)
  const evidenceDir = await evidenceDirectory()
  console.info('[website-shots] scratch profile', root)
  console.info('[website-shots] evidence', evidenceDir)
  let app: ConnectedElectrobunApp | null = null
  let page: Page | null = null
  // The one scripted model behind every real Run; Pi reaches it through the scratch agent
  // directory's auth.json and models.json, written before the first launch.
  let model: FixtureModelServer | null = null
  try {
    model = await startFixtureModelServer([...MODEL_SCENARIOS, WAGGLE_SCENARIO])
    await writeFixturePiAgent({ ...profile, model })
    const project = await createScreenshotProject({
      rootDir: ROOT_DIR,
      projectPath: path.join(root, PROJECT_NAME),
      homeDir: profile.homeDir,
      worktreeIds: SCREENSHOT_WORKTREE_IDS,
    })
    await addFeatureProjectFiles(project, profile.homeDir)
    const launched = await launchSeededApp(await appLauncher(), profile, project)
    app = launched.app
    page = launched.page
    const rendererErrors = observeRendererErrors(launched.page)
    await runCaptures(
      {
        app,
        page: launched.page,
        outputDir: stagingDir,
        evidenceDir,
        homeDir: profile.homeDir,
        userDataDir: profile.userDataDir,
        model,
        seedFeatureSessionsOnce: launched.seedFeatureSessionsOnce,
      },
      screenshots,
    )
    if (rendererErrors.length > 0) {
      throw new Error(`Screenshot capture saw renderer errors: ${rendererErrors.join(' | ')}`)
    }
    await publishScreenshots({ stagingDir, outputDir: SCREENSHOT_OUTPUT_DIR, screenshots })
    console.info('[website-shots] screenshot capture complete')
  } finally {
    if (page) {
      await settleEssentials(page).catch((error: unknown) => {
        console.warn('[website-shots] could not settle the essentials Sessions', error)
      })
    }
    await app?.close().catch(() => undefined)
    // Ends any Run still streaming from it before the Host is asked to drain.
    await model?.close()
    await releaseScratchProfile(profile)
  }
}

/**
 * The Session Host is detached from the GUI and would keep the profile's SQLite files open, so it
 * is stopped first. A Host that did not stop keeps its profile: deleting files a live Host holds
 * open is worse than leaving a scratch directory behind.
 */
async function releaseScratchProfile(profile: ScratchProfile) {
  try {
    await stopQaProfileSessionHost(profile.userDataDir)
  } catch (error) {
    console.error(`[website-shots] Session Host shutdown failed; kept ${profile.root}`, error)
    process.exitCode = 1
    return
  }
  await fs.rm(profile.root, { recursive: true, force: true })
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)
  process.exitCode = 1
})
