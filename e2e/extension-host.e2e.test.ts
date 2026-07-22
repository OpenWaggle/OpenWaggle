import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import {
  GITHUB_ISSUES_EXTENSION_ID,
  GITHUB_ISSUES_EXTENSION_NAME,
  GITHUB_ISSUES_SETTINGS_TITLE,
  installProjectExtensionFixture,
  projectExtensionFixtureExists,
  setActiveProjectForExtensionQa,
} from './support/extension-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SEEDED_SESSION_TITLE = 'Extension host proof session'
const SEEDED_MESSAGE_TEXT = 'extension-host-proof-project'
const EXTENSION_FRAME_TITLE = `Extension module: ${GITHUB_ISSUES_SETTINGS_TITLE}`

function seededProjectMessage() {
  return {
    id: 'extension-host-proof-message',
    role: 'user',
    createdAt: Date.now(),
    parts: [{ type: 'text', text: SEEDED_MESSAGE_TEXT }],
  }
}

async function openExtensionsSettings(page: Page) {
  const [baseUrl] = page.url().split('#')
  await page.goto(`${baseUrl}#/settings/extensions`)
  await expect(page.getByRole('heading', { name: 'Extensions' })).toBeVisible()
}

function lifecycleButton(page: Page, action: string) {
  return page.getByRole('button', {
    name: `${action} ${GITHUB_ISSUES_EXTENSION_NAME}`,
  })
}

test('project extension can be trusted, enabled, rendered, disabled, and removed through settings', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-extension-host-e2e-')
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-project-'))

  try {
    await installProjectExtensionFixture({
      projectPath,
      extensionId: GITHUB_ISSUES_EXTENSION_ID,
    })
    await seedSingleSession(app.userDataDir, {
      title: SEEDED_SESSION_TITLE,
      updatedAt: Date.now(),
      projectPath,
      messages: [seededProjectMessage()],
    })
    await setActiveProjectForExtensionQa(app.window(), projectPath)
    await app.restart()

    const page = app.window()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await openExtensionsSettings(page)

    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_EXTENSION_NAME }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toHaveCount(0)

    await lifecycleButton(page, 'Trust').click()
    await expect(lifecycleButton(page, 'Enable')).toBeEnabled()

    await lifecycleButton(page, 'Enable').click()
    await expect(page.getByText('Reload required')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toHaveCount(0)

    await lifecycleButton(page, 'Reload').click()
    await expect(page.getByText('Reloaded')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toBeVisible()

    const settingsFrame = page.frameLocator(`iframe[title="${EXTENSION_FRAME_TITLE}"]`)
    await expect(settingsFrame.getByText('Extension configuration')).toBeVisible()
    await expect(settingsFrame.getByRole('heading', { name: 'GitHub Issues' })).toBeVisible()

    await settingsFrame.getByLabel('Repository owner').fill('OpenWaggle')
    await settingsFrame.getByLabel('Repository name').fill('OpenWaggle')
    await settingsFrame.getByRole('button', { name: 'Save configuration' }).click()
    await expect(
      settingsFrame.getByText('Configuration saved. The side panel will use it on the next refresh.'),
    ).toBeVisible()

    await lifecycleButton(page, 'Disable').click()
    await expect(lifecycleButton(page, 'Enable')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toHaveCount(0)
    await expect(page.locator(`iframe[title="${EXTENSION_FRAME_TITLE}"]`)).toHaveCount(0)

    await app.confirmNativeDialogs()
    await lifecycleButton(page, 'Remove').click()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_EXTENSION_NAME }),
    ).toHaveCount(0)
    await expect
      .poll(() =>
        projectExtensionFixtureExists({
          projectPath,
          extensionId: GITHUB_ISSUES_EXTENSION_ID,
        }),
      )
      .toBe(false)
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await app.cleanup()
    await fs.rm(projectPath, { recursive: true, force: true })
  }
})
