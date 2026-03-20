import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { seedSingleConversation } from '../e2e/support/conversation-fixtures'

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
const PROJECT_NAME = 'OpenWaggle'
const THREAD_TITLE = 'review this waggle fix before merge'
const THREAD_PROMPT =
  'I just fixed the waggle streaming regression. Please review the changes, challenge the risky parts, and tell me whether this branch is ready to merge.'
const THREAD_LIST_MATCHER = /review this waggle/i

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

async function restartApp(
  currentApp: ElectronApplication,
  userDataDir: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  await currentApp.close()
  return launchApp(userDataDir)
}

async function configureProject(page: Page, projectPath: string): Promise<void> {
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

async function createProjectAlias(userDataDir: string): Promise<string> {
  const projectLinksDir = path.join(userDataDir, 'projects')
  const aliasedProjectPath = path.join(projectLinksDir, PROJECT_NAME)
  await fs.mkdir(projectLinksDir, { recursive: true })
  await fs.rm(aliasedProjectPath, { recursive: true, force: true }).catch(() => undefined)
  await fs.symlink(ROOT_DIR, aliasedProjectPath, 'dir')
  return aliasedProjectPath
}

function makeWaggleMetadata(agentLabel: 'Advocate' | 'Critic', turnNumber: number) {
  const isAdvocate = agentLabel === 'Advocate'

  return {
    agentIndex: isAdvocate ? 0 : 1,
    agentLabel,
    agentColor: isAdvocate ? 'blue' : 'amber',
    agentModel: isAdvocate ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
    turnNumber,
  }
}

async function seedMarketingConversation(userDataDir: string, projectPath: string): Promise<void> {
  console.info('[website-shots] seeding marketing conversation')
  const now = Date.now()

  await seedSingleConversation(userDataDir, {
    title: THREAD_TITLE,
    projectPath,
    updatedAt: now,
    waggleConfig: {
      mode: 'sequential',
      agents: [
        {
          label: 'Advocate',
          model: 'claude-opus-4-6',
          roleDescription: 'Argues for the strongest technical case',
          color: 'blue',
        },
        {
          label: 'Critic',
          model: 'claude-sonnet-4-6',
          roleDescription: 'Challenges assumptions and validates evidence',
          color: 'amber',
        },
      ],
      stop: {
        primary: 'consensus',
        maxTurnsSafety: 5,
      },
    },
    messages: [
      {
        id: 'website-user-1',
        role: 'user',
        createdAt: now - 7_000,
        parts: [{ type: 'text', text: THREAD_PROMPT }],
      },
      {
        id: 'website-assistant-1',
        role: 'assistant',
        model: 'claude-opus-4-6',
        createdAt: now - 6_000,
        metadata: { waggle: makeWaggleMetadata('Advocate', 0) },
        parts: [
          {
            type: 'text',
            text: [
              "I'll review this the way a careful teammate would: verify the renderer behavior, trace the IPC normalization, and confirm the branch is actually safe to merge.",
              '',
              '**Initial review sweep**',
              '',
              '- Read the waggle IPC handler and streaming normalization path',
              '- Read the chat row builder and scroll behavior hooks',
              '- Check the tests that were added for navigation, live streaming, and restore behavior',
              '',
              "What I'm looking for is straightforward: does the branch actually fix the live waggle rendering regression, or did it just move the problem around? I also want to confirm the new scroll behavior doesn't introduce fresh navigation weirdness.",
              '',
              '**Next verification pass**',
              '',
              '- Inspect how stable message IDs are enforced across tool continuations',
              '- Compare live transcript behavior against persisted reload behavior',
              '- Verify that per-thread scroll restore does not suppress normal send-anchor UX',
            ].join('\n'),
          },
        ],
      },
      {
        id: 'website-assistant-2',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        createdAt: now - 5_000,
        metadata: { waggle: makeWaggleMetadata('Critic', 1) },
        parts: [
          {
            type: 'text',
            text: [
              "I'm less worried about the happy path and more worried about merge readiness. These kinds of fixes often look great in manual testing while hiding edge-case regressions in approvals, reloads, or thread switching.",
              '',
              '**Risk areas I want challenged**',
              '',
              '- Live message attribution can still drift when turns hydrate in multiple passes',
              '- Scroll restoration can interfere with the "scroll user message near top" behavior if the timing is off',
              '- Temporary debug instrumentation or devtools visibility could accidentally leak into polished captures or production builds',
              '',
              "So my standard is stricter than 'looks fixed.' I want evidence that the branch is reliable under realistic navigation, reload, and review workflows before we call it merge-ready.",
            ].join('\n'),
          },
        ],
      },
      {
        id: 'website-assistant-3',
        role: 'assistant',
        model: 'claude-opus-4-6',
        createdAt: now - 4_000,
        metadata: { waggle: makeWaggleMetadata('Advocate', 2) },
        parts: [
          {
            type: 'text',
            text: [
              "The Critic is asking the right merge question, so I drilled into the implementation details instead of relying on screenshots alone. The strongest sign here is that the fix doesn't live in one place; it coordinates stream normalization, row building, and scroll policy together.",
              '',
              '**What I verified in code**',
              '',
              '- The waggle stream now normalizes repeated text events into stable assistant message IDs per turn',
              '- The renderer prefers live waggle metadata and skips empty label-only assistant rows',
              '- The scroll hook now restores per-thread position and blocks navigation-triggered anchor jumps while preserving normal send-anchor behavior',
              '',
              "That shape matters. It tells me this wasn't a cosmetic patch; it was a systems fix that aligns the backend stream contract with what the transcript renderer expects. That's a much better sign for merge confidence.",
            ].join('\n'),
          },
        ],
      },
      {
        id: 'website-assistant-4',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        createdAt: now - 3_000,
        metadata: { waggle: makeWaggleMetadata('Critic', 3) },
        parts: [
          {
            type: 'text',
            text: [
              "I agree the implementation is much cleaner now, but I still want to judge it like a skeptical reviewer. The remaining question isn't whether the main bug is improved; it's whether the branch is defended against regression.",
              '',
              '**What would convince me**',
              '',
              '- Targeted tests for repeated waggle turn chunks, row cleanup, and thread-navigation restore',
              '- A realistic end-to-end check where you switch threads, return, and still get normal user-message anchoring on a new send',
              '- Clean output with the debug tracing and visible devtools affordances removed once the investigation is over',
              '',
              "If those safeguards are in place, then I'm comfortable saying the branch is not only fixed but responsibly hardened. Without them, this is still the sort of UI regression that could come back the next time the transcript code gets touched.",
            ].join('\n'),
          },
        ],
      },
      {
        id: 'website-assistant-5',
        role: 'assistant',
        model: 'claude-opus-4-6',
        createdAt: now - 2_000,
        metadata: { waggle: makeWaggleMetadata('Advocate', 4) },
        parts: [
          {
            type: 'text',
            text: [
              "Excellent. After weighing the implementation and the reviewer concerns together, I think the answer is yes: this branch looks ready to merge, provided the verification pass stays green and the temporary debugging affordances are removed.",
              '',
              '**Advocate merge recommendation**',
              '',
              'The main regression fix is real: live waggle turns render coherently, per-thread scroll memory behaves properly, and the transcript no longer jumps back to the initiating user message on navigation.',
              '',
              "What pushes it over the line is the hardening around it: regression coverage, cleaner screenshot output, and a more predictable capture flow for the website. That's the kind of follow-through that makes a fix safe to land instead of merely impressive in a demo.",
            ].join('\n'),
          },
        ],
      },
    ],
  })
}

async function waitForUi(page: Page): Promise<void> {
  await page.waitForTimeout(UI_SETTLE_DELAY_MS)
}

async function openThread(page: Page, threadTitle: string): Promise<void> {
  console.info('[website-shots] opening thread', threadTitle)
  const thread = page.getByText(THREAD_LIST_MATCHER).first()
  await thread.waitFor()
  await thread.click()
  await waitForUi(page)
}

async function captureHeroScreenshot(page: Page): Promise<void> {
  console.info('[website-shots] capturing hero screenshot')
  await page.getByRole('button', { name: 'New thread' }).first().click()
  await waitForUi(page)
  await page.locator('header').click()
  await waitForUi(page)
  await page.screenshot({ path: HERO_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureCodingScreenshot(page: Page): Promise<void> {
  console.info('[website-shots] capturing coding screenshot')
  await openThread(page, THREAD_TITLE)
  await page.screenshot({ path: CODING_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureGitScreenshot(page: Page): Promise<void> {
  console.info('[website-shots] capturing git screenshot')
  await openThread(page, THREAD_TITLE)
  await page.getByRole('button', { name: 'Toggle diff panel' }).click()
  await page.getByRole('button', { name: /Stage all/ }).waitFor()
  await waitForUi(page)
  await page.screenshot({ path: GIT_SCREENSHOT_PATH, animations: 'disabled' })
}

async function captureExtensibleScreenshot(page: Page): Promise<void> {
  console.info('[website-shots] capturing extensibility screenshot')
  await page.getByRole('button', { name: 'MCPs' }).click()
  await page.getByRole('heading', { name: 'MCPs' }).waitFor()
  await page.getByText('Registry').waitFor()
  await waitForUi(page)
  await page.screenshot({ path: EXTENSIBLE_SCREENSHOT_PATH, animations: 'disabled' })
}

async function main(): Promise<void> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-website-shots-'))
  const projectPath = await createProjectAlias(userDataDir)
  await fs.mkdir(SCREENSHOT_OUTPUT_DIR, { recursive: true })

  let currentApp: ElectronApplication | null = null

  try {
    let launched = await launchApp(userDataDir)
    currentApp = launched.app

    await configureProject(launched.page, projectPath)
    await seedMarketingConversation(userDataDir, projectPath)

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
