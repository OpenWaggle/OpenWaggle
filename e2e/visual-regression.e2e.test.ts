import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessionResources, seedSessions } from './support/session-fixtures'

const VIEWPORT = { width: 1200, height: 800 }
const FIXED_NOW = Date.UTC(2026, 6, 14, 12)
const PRIMARY_UPDATED_AT = FIXED_NOW - 2 * 60_000
const SECONDARY_UPDATED_AT = FIXED_NOW - 4 * 60 * 60_000
const SETTINGS_PREVIEW_SETTLE_MS = 300
const PROJECT_LABEL = 'visual-regression-repo'
const PRIMARY_TITLE = 'Polish the review workflow'
const SECONDARY_TITLE = 'Document keyboard navigation'
const CHANGED_FILE_PATH = 'src/visual-regression.ts'
const SCREENSHOT_OPTIONS = {
  animations: 'disabled',
  caret: 'hide',
  // Current Darwin runners rasterize the same, layout-identical text with a
  // measured 0.63% pixel delta. Keep the allowance below one percent so
  // geometry, spacing, and component regressions still fail the baseline.
  maxDiffPixelRatio: 0.007,
} as const
const SETTINGS_SCREENSHOT_OPTIONS = {
  ...SCREENSHOT_OPTIONS,
  // The settings surface is text-dense; the current Darwin runner differs
  // from the captured Apple-silicon baseline by 0.81% with identical layout.
  maxDiffPixelRatio: 0.009,
} as const

function initializeRepository(projectPath: string) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
}

async function pngData(background: string) {
  return (
    await sharp({
      create: { width: 1_200, height: 900, channels: 4, background },
    })
      .png()
      .toBuffer()
  ).toString('base64')
}

async function createChangedRepository(projectPath: string) {
  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
  initializeRepository(projectPath)

  await fs.writeFile(
    path.join(projectPath, CHANGED_FILE_PATH),
    [
      'export function visualRegressionStatus() {',
      "  return 'baseline ready'",
      '}',
      '',
    ].join('\n'),
  )
  execFileSync('git', ['add', CHANGED_FILE_PATH], { cwd: projectPath, stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=OpenWaggle E2E',
      '-c',
      'user.email=e2e@openwaggle.dev',
      'commit',
      '--no-gpg-sign',
      '-m',
      'Seed visual regression fixture',
    ],
    { cwd: projectPath, stdio: 'ignore' },
  )
  execFileSync(
    'git',
    ['remote', 'add', 'origin', 'http://github.localhost:1/openwaggle/visual-regression.git'],
    { cwd: projectPath, stdio: 'ignore' },
  )
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
  execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], {
    cwd: projectPath,
    stdio: 'ignore',
  })

  await fs.writeFile(
    path.join(projectPath, CHANGED_FILE_PATH),
    [
      'export function visualRegressionStatus() {',
      "  return 'baseline stable'",
      '}',
      '',
      "export const reviewNote = 'Summary, resources, images, review requests, diff, and settings are covered.'",
      '',
    ].join('\n'),
  )
}

async function installVisualGhClient() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-visual-gh-'))
  const executablePath = path.join(directory, 'gh')
  await fs.writeFile(
    executablePath,
    `#!/bin/sh
if [ "$1" = "auth" ]; then
  if [ "$2" != "status" ] || [ "$3" != "--active" ] || [ "$4" != "--hostname" ] || [ "$5" != "github.localhost" ] || [ -n "$6" ]; then
    echo "unexpected gh auth arguments: $*" >&2
    exit 64
  fi
  echo "github.localhost"
  echo "  Logged in to github.localhost account visual-bot"
  exit 0
fi
exit 1
`,
  )
  await fs.chmod(executablePath, 0o755)
  return directory
}

async function waitForVisualReadiness(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

test('Session Summary and primary surfaces match their visual baselines', { tag: '@visual' }, async () => {
  const fakeGhPath = await installVisualGhClient()
  const originalPath = process.env.PATH
  process.env.PATH = `${fakeGhPath}${path.delimiter}${originalPath ?? ''}`
  let app: OpenWaggleApp | null = null

  try {
    app = await OpenWaggleApp.launch('openwaggle-visual-regression-e2e-')
    const projectPath = path.join(app.userDataDir, PROJECT_LABEL)
    await createChangedRepository(projectPath)
    const [primarySessionId] = await seedSessions(app.userDataDir, [
      {
        title: PRIMARY_TITLE,
        projectPath,
        updatedAt: PRIMARY_UPDATED_AT,
        messages: [
          {
            id: 'visual-primary-user-1',
            role: 'user',
            createdAt: FIXED_NOW - 8 * 60_000,
            parts: [
              {
                type: 'text',
                text: 'Review every permanent visual baseline and keep the fixture deterministic.',
              },
            ],
          },
          {
            id: 'visual-primary-assistant-1',
            role: 'assistant',
            createdAt: FIXED_NOW - 7 * 60_000,
            parts: [
              {
                type: 'text',
                text: 'The seeded repository has one committed TypeScript file and a focused working-tree edit ready for review.',
              },
            ],
          },
          {
            id: 'visual-primary-user-2',
            role: 'user',
            createdAt: FIXED_NOW - 3 * 60_000,
            parts: [{ type: 'text', text: 'Confirm the diff and settings views are populated.' }],
          },
          {
            id: 'visual-primary-assistant-2',
            role: 'assistant',
            createdAt: PRIMARY_UPDATED_AT,
            parts: [
              {
                type: 'text',
                text: 'All covered surfaces now use stable semantic locators and fixed rendering inputs.',
              },
            ],
          },
        ],
      },
      {
        title: SECONDARY_TITLE,
        projectPath,
        updatedAt: SECONDARY_UPDATED_AT,
        messages: [
          {
            id: 'visual-secondary-user-1',
            role: 'user',
            createdAt: SECONDARY_UPDATED_AT - 60_000,
            parts: [{ type: 'text', text: 'Capture the sidebar with more than one session.' }],
          },
          {
            id: 'visual-secondary-assistant-1',
            role: 'assistant',
            createdAt: SECONDARY_UPDATED_AT,
            parts: [{ type: 'text', text: 'The second deterministic session is ready.' }],
          },
        ],
      },
    ])
    if (!primarySessionId) throw new Error('Primary visual-regression session was not seeded')
    await seedSessionResources(app.userDataDir, primarySessionId, [
      {
        id: 'visual-agent-output',
        kind: 'image',
        title: 'session-summary-output.png',
        mimeType: 'image/png',
        dataBase64: await pngData('#3778d4'),
        nodeId: 'visual-primary-assistant-2',
        actor: 'agent',
        activity: 'created',
        updatedAt: PRIMARY_UPDATED_AT,
      },
      {
        id: 'visual-source-link',
        kind: 'link',
        title: 'OpenWaggle session resources',
        url: 'https://openwaggle.dev/docs/using-openwaggle/session-summary',
        nodeId: 'visual-primary-assistant-2',
        actor: 'agent',
        activity: 'read',
        updatedAt: PRIMARY_UPDATED_AT,
      },
    ])
    await app.restart()

    const { page } = app.mainWindow()
    await page.setViewportSize(VIEWPORT)
    await page.clock.setFixedTime(FIXED_NOW)
    await page.reload()
    await app.mainWindow().waitUntilReady()
    await app.mainWindow().openThread(PRIMARY_TITLE)

    await page.getByRole('button', { name: 'New session', exact: true }).click()
    const welcome = page.getByRole('region', { name: 'Welcome' })
    await expect(welcome.getByRole('heading', { name: "Let's build" })).toBeVisible()
    await expect(welcome.getByTitle('Open project picker')).toContainText(PROJECT_LABEL)
    await waitForVisualReadiness(page)
    await expect(welcome).toHaveScreenshot('welcome.png', SCREENSHOT_OPTIONS)

    await app.mainWindow().openThread(PRIMARY_TITLE)

    const sidebar = page.locator('nav[aria-label="Sidebar"]')
    const composer = page.getByRole('region', { name: 'Composer file drop zone' })
    const transcript = page.getByRole('log', { name: 'Chat messages' })
    const summary = page.getByRole('complementary', { name: 'Session Summary' })

    await expect(sidebar.getByText(PRIMARY_TITLE)).toBeVisible()
    await expect(sidebar.getByText(SECONDARY_TITLE)).toBeVisible()
    await expect(
      sidebar.locator('[data-qa="sidebar-session-row"]').filter({ hasText: PRIMARY_TITLE }),
    ).toContainText('2m')
    await expect(composer.getByRole('textbox', { name: 'Message input' })).toBeVisible()
    await expect(transcript).toHaveAttribute('aria-busy', 'false')
    await expect(
      transcript.getByText(
        'All covered surfaces now use stable semantic locators and fixed rendering inputs.',
      ),
    ).toBeVisible()
    await expect(summary).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Create PR' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(summary.getByRole('button', { name: 'Branch: main' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+3', {
      timeout: 30_000,
    })
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    const sidebarPinButtons = sidebar.getByRole('button', { name: /^Pin session/ })
    await expect(sidebarPinButtons.first()).toHaveCSS('opacity', '0')
    await expect(sidebarPinButtons.last()).toHaveCSS('opacity', '0')
    await waitForVisualReadiness(page)

    await expect(composer).toHaveScreenshot('composer.png', SCREENSHOT_OPTIONS)
    await expect(sidebar).toHaveScreenshot('sidebar.png', SCREENSHOT_OPTIONS)
    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
    await expect(summary).toHaveCount(0)
    await expect(transcript).toHaveScreenshot('transcript.png', SCREENSHOT_OPTIONS)
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
    await expect(summary).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Branch: main' })).toBeVisible({
      timeout: 30_000,
    })

    await summary.getByRole('button', { name: 'Outputs 1' }).click()
    await expect(summary.getByRole('button', { name: 'session-summary-output.png' })).toBeVisible()
    await page.mouse.move(10, 10)
    await waitForVisualReadiness(page)
    await expect(summary).toHaveScreenshot('session-summary.png', SCREENSHOT_OPTIONS)

    await summary.getByRole('button', { name: 'session-summary-output.png' }).click()
    const imageViewer = page.getByRole('dialog', {
      name: 'Image viewer: session-summary-output.png',
    })
    await expect(imageViewer).toBeVisible()
    await waitForVisualReadiness(page)
    await expect(imageViewer).toHaveScreenshot('session-image-viewer.png', SCREENSHOT_OPTIONS)
    await imageViewer.getByRole('button', { name: 'Close image viewer' }).click()

    await summary.getByRole('button', { name: 'Sources 1' }).click()
    await summary.getByRole('button', { name: 'Show all' }).click()
    const resourcesPanel = page.getByRole('region', { name: 'Session resources' })
    await expect(resourcesPanel.getByText('OpenWaggle session resources')).toBeVisible()
    await page.mouse.move(10, 10)
    await waitForVisualReadiness(page)
    await expect(resourcesPanel).toHaveScreenshot('session-resources-panel.png', SCREENSHOT_OPTIONS)
    await resourcesPanel.getByRole('button', { name: 'Close resources' }).click()

    await expect(summary).toBeVisible()
    await summary.getByRole('button', { name: 'Create PR' }).click()
    const changeRequestComposer = page.getByRole('dialog', { name: 'Create pull request' })
    await expect(changeRequestComposer.getByText('GitHub CLI ready as visual-bot.')).toBeVisible({
      timeout: 30_000,
    })
    await page.mouse.move(10, 10)
    await waitForVisualReadiness(page)
    await expect(changeRequestComposer).toHaveScreenshot(
      'change-request-composer.png',
      SCREENSHOT_OPTIONS,
    )
    await changeRequestComposer.getByRole('button', { name: 'Close change request composer' }).click()

    const diffToggle = page.getByRole('button', { name: 'Toggle diff panel' })
    await diffToggle.click()
    const diffPanel = page.locator('aside[data-right-sidebar-shell="true"]')
    await expect(diffPanel).not.toHaveAttribute('inert', '')
    await expect(
      diffPanel.getByText('visual-regression.ts', { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(diffPanel.locator('.diff-scroll code').first()).toBeVisible({ timeout: 30_000 })
    await expect(diffPanel.getByRole('status', { name: 'Loading' })).toHaveCount(0)
    await expect(diffPanel.getByText('No changes to review')).toHaveCount(0)
    await expect(diffPanel.getByRole('button', { name: 'Commit' })).toBeEnabled({ timeout: 30_000 })
    await expect(diffPanel.getByRole('button', { name: 'Revert all' })).toBeEnabled()
    await expect(diffPanel.getByRole('button', { name: '+ Stage all' })).toBeEnabled()
    await page.mouse.move(10, 10)
    await waitForVisualReadiness(page)
    await expect(diffPanel).toHaveScreenshot('diff-panel.png', SCREENSHOT_OPTIONS)

    await page.getByRole('button', { name: 'Close diff sidebar' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const settingsRoot = page.locator('#root')
    const settingsContent = settingsRoot.getByRole('heading', { name: 'Review presentation' })
    await expect(settingsContent).toBeVisible()
    await expect(settingsRoot.getByRole('heading', { name: 'Color and syntax' })).toBeVisible()
    await expect(settingsRoot.getByRole('heading', { name: 'Typography' })).toBeVisible()
    const syntaxPreview = settingsRoot.getByRole('region', {
      name: 'TypeScript syntax theme preview',
    })
    await expect(syntaxPreview).toHaveAttribute('data-syntax-status', 'highlighted')
    await expect(syntaxPreview.locator('[data-line-number]')).toHaveCount(9)
    // The highlighted result and the SourceView ResizeObserver settle in
    // separate browser tasks. Capture the durable layout, not the transient
    // first frame that can appear between those commits on a loaded runner.
    await page.waitForTimeout(SETTINGS_PREVIEW_SETTLE_MS)
    await page.mouse.move(VIEWPORT.width - 10, 10)
    await waitForVisualReadiness(page)
    await expect(settingsRoot).toHaveScreenshot('settings.png', SETTINGS_SCREENSHOT_OPTIONS)
  } finally {
    await app?.cleanup()
    process.env.PATH = originalPath
    await fs.rm(fakeGhPath, { recursive: true, force: true })
  }
})
