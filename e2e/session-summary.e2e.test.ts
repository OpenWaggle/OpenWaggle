import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessionResources, seedSingleSession } from './support/session-fixtures'

const EMPTY_TITLE = 'Session Summary empty session'
const ALPHA_TITLE = 'Session Summary alpha'
const BETA_TITLE = 'Session Summary beta'
const ALPHA_USER_MESSAGE_ID = 'summary-alpha-user'
const ALPHA_AGENT_MESSAGE_ID = 'summary-alpha-agent'
const BETA_USER_MESSAGE_ID = 'summary-beta-user'

function message(id: string, role: 'user' | 'assistant', text: string, createdAt: number) {
  return { id, role, parts: [{ type: 'text', text }], createdAt }
}

function svgData(color: string) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`,
  ).toString('base64')
}

async function createGitProject(projectPath: string) {
  await fs.mkdir(projectPath, { recursive: true })
  await fs.writeFile(path.join(projectPath, 'README.md'), '# Session Summary E2E\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath, stdio: 'ignore' })
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
      'Seed Session Summary fixture',
    ],
    { cwd: projectPath, stdio: 'ignore' },
  )
  await fs.appendFile(path.join(projectPath, 'README.md'), '\nUncommitted change\n')
}

test('Session Summary follows first-message, dock, and sidebar behavior', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-lifecycle-')
  const projectPath = path.join(app.userDataDir, 'github-project')
  try {
    await createGitProject(projectPath)
    await seedSingleSession(app.userDataDir, {
      title: EMPTY_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await seedSingleSession(app.userDataDir, {
      title: ALPHA_TITLE,
      projectPath,
      updatedAt: Date.now() - 1,
      messages: [message(ALPHA_USER_MESSAGE_ID, 'user', 'Start the populated session.', Date.now())],
    })
    await app.restart()

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    const setupDock = page.locator('fieldset[aria-label="Session setup"]')
    await mainWindow.openThread(EMPTY_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toHaveCount(0)
    await expect(setupDock).toHaveAttribute('aria-hidden', 'false')

    await mainWindow.openThread(ALPHA_TITLE)
    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    await expect(summary).toBeVisible()
    await expect(setupDock).toHaveAttribute('aria-hidden', 'true')
    await expect(summary.getByText('main')).toBeVisible({ timeout: 30_000 })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+2')

    await page.getByRole('button', { name: 'Toggle diff panel' }).click()
    await expect(summary).toHaveCount(0)
    await page.getByRole('button', { name: 'Close diff sidebar' }).click()
    await expect(summary).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('session resources stay scoped while inline images and the gallery navigate', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-resources-')
  try {
    const now = Date.now()
    const alphaId = await seedSingleSession(app.userDataDir, {
      title: ALPHA_TITLE,
      updatedAt: now,
      messages: [
        message(ALPHA_USER_MESSAGE_ID, 'user', 'Here is the source image.', now - 2),
        message(ALPHA_AGENT_MESSAGE_ID, 'assistant', 'Here is the generated image.', now - 1),
      ],
    })
    const betaId = await seedSingleSession(app.userDataDir, {
      title: BETA_TITLE,
      updatedAt: now - 10,
      messages: [message(BETA_USER_MESSAGE_ID, 'user', 'Beta image only.', now - 10)],
    })
    await seedSessionResources(app.userDataDir, alphaId, [
      {
        id: 'alpha-user-image',
        kind: 'image',
        title: 'user-reference.svg',
        mimeType: 'image/svg+xml',
        dataBase64: svgData('#3b82f6'),
        nodeId: ALPHA_USER_MESSAGE_ID,
        actor: 'user',
        activity: 'provided',
        updatedAt: now,
      },
      {
        id: 'alpha-agent-image',
        kind: 'image',
        title: 'agent-output.svg',
        mimeType: 'image/svg+xml',
        dataBase64: svgData('#22c55e'),
        nodeId: ALPHA_AGENT_MESSAGE_ID,
        actor: 'agent',
        activity: 'created',
        updatedAt: now - 1,
      },
      {
        id: 'alpha-docs',
        kind: 'link',
        title: 'Alpha documentation',
        url: 'https://example.com/alpha',
        nodeId: ALPHA_AGENT_MESSAGE_ID,
        actor: 'agent',
        activity: 'read',
        updatedAt: now - 2,
      },
    ])
    await seedSessionResources(app.userDataDir, betaId, [
      {
        id: 'beta-user-image',
        kind: 'image',
        title: 'beta-only.svg',
        mimeType: 'image/svg+xml',
        dataBase64: svgData('#a855f7'),
        nodeId: BETA_USER_MESSAGE_ID,
        actor: 'user',
        activity: 'provided',
        updatedAt: now - 10,
      },
    ])
    await app.restart()

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(ALPHA_TITLE)
    const inlineUserImage = page.getByRole('button', { name: 'Open image user-reference.svg' })
    await expect(inlineUserImage).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open image agent-output.svg' })).toBeVisible()

    await inlineUserImage.click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })).toBeVisible()
    await page.keyboard.press('Escape')

    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    await summary.getByRole('button', { name: /Sources/ }).click()
    await summary.getByText('user-reference.svg').click()

    const resources = page.getByRole('region', { name: 'Session resources' })
    await expect(resources).toBeVisible()
    await expect(summary).toHaveCount(0)
    await expect(resources.getByText('user-reference.svg')).toBeVisible()
    await expect(resources.getByText('agent-output.svg')).toBeVisible()
    await expect(resources.getByText('beta-only.svg')).toHaveCount(0)

    await resources.getByText('user-reference.svg').click()
    const viewer = page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('1 of 2')
    await viewer.getByLabel('Image zoom').selectOption('150')
    await expect(viewer.getByLabel('Image zoom')).toHaveValue('150')
    await viewer.getByRole('button', { name: 'Next image' }).click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: agent-output.svg' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })).toBeVisible()
    await page.getByRole('button', { name: 'Close image viewer' }).click()
    await resources.getByRole('button', { name: 'Close resources' }).click()
    await expect(summary).toBeVisible()

    await mainWindow.openThread(BETA_TITLE)
    const betaSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await betaSummary.getByRole('button', { name: /Sources/ }).click()
    await expect(betaSummary.getByText('beta-only.svg')).toBeVisible()
    await expect(betaSummary.getByText('user-reference.svg')).toHaveCount(0)
    await betaSummary.getByRole('button', { name: 'Collapse Session Summary' }).click()

    await mainWindow.openThread(ALPHA_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toBeVisible()
    await mainWindow.openThread(BETA_TITLE)
    await expect(page.getByRole('button', { name: 'Open Session Summary' })).toBeVisible()
  } finally {
    await app.cleanup()
  }
})
