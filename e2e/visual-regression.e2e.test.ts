import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

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

  await fs.writeFile(
    path.join(projectPath, CHANGED_FILE_PATH),
    [
      'export function visualRegressionStatus() {',
      "  return 'baseline stable'",
      '}',
      '',
      "export const reviewNote = 'Composer, sidebar, transcript, diff, and settings are covered.'",
      '',
    ].join('\n'),
  )
}

async function waitForVisualReadiness(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

test('six primary surfaces match their visual baselines', { tag: '@visual' }, async () => {
  const app = await OpenWaggleApp.launch('openwaggle-visual-regression-e2e-')
  const projectPath = path.join(app.userDataDir, PROJECT_LABEL)

  try {
    await createChangedRepository(projectPath)
    await seedSessions(app.userDataDir, [
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
                text: 'Review the five permanent visual baselines and keep the fixture deterministic.',
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
                text: 'All five surfaces now use stable semantic locators and fixed rendering inputs.',
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

    // The session terminal panel captures its deterministic empty state: the
    // tab strip chrome plus the "new terminals run in <Working path>" hint.
    // A live shell's output is intentionally excluded — scrollback content is
    // not pixel-stable enough for a baseline — and the hint's Working path
    // embeds the run's temp dir suffix, so that line is masked.
    await page.keyboard.press('Meta+j')
    const terminalPanel = page.getByTestId('workspace-terminal')
    await expect(terminalPanel.getByText('No terminal for this session yet')).toBeVisible()
    await expect(terminalPanel.getByText(PROJECT_LABEL)).toBeVisible()
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
    await waitForVisualReadiness(page)
    await expect(terminalPanel).toHaveScreenshot('terminal-panel.png', {
      ...SCREENSHOT_OPTIONS,
      mask: [terminalPanel.getByText(/New terminals run in/)],
    })
    await page.keyboard.press('Meta+j')

    await app.mainWindow().openThread(PRIMARY_TITLE)

    const sidebar = page.locator('nav[aria-label="Sidebar"]')
    const composer = page.getByRole('region', { name: 'Composer file drop zone' })
    const transcript = page.getByRole('log', { name: 'Chat messages' })

    await expect(sidebar.getByText(PRIMARY_TITLE)).toBeVisible()
    await expect(sidebar.getByText(SECONDARY_TITLE)).toBeVisible()
    await expect(
      sidebar.locator('[data-qa="sidebar-session-row"]').filter({ hasText: PRIMARY_TITLE }),
    ).toContainText('2m')
    await expect(composer.getByRole('textbox', { name: 'Message input' })).toBeVisible()
    await expect(transcript).toHaveAttribute('aria-busy', 'false')
    await expect(
      transcript.getByText('All five surfaces now use stable semantic locators and fixed rendering inputs.'),
    ).toBeVisible()
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
    await expect(transcript).toHaveScreenshot('transcript.png', SCREENSHOT_OPTIONS)

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
    await app.cleanup()
  }
})
