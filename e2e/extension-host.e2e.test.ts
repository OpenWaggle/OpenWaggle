import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
const SAVED_REPOSITORY_OWNER = 'OpenWaggle-e2e'
const SAVED_REPOSITORY_NAME = 'OpenWaggle-e2e-fixture'
const EXTENSION_CONFIG_KEY = 'github.issues.config'
// The extension host mounts federation modules and iframes asynchronously. Under loaded
// CI runners that regularly exceeds the 5s default expect budget, so the mount-dependent
// assertions below use an explicit ceiling. The ceiling is not a wait: assertions still
// resolve as soon as the element appears.
const EXTENSION_MOUNT_TIMEOUT = 30_000

function readStoredConfiguration(userDataDir: string) {
  const database = new DatabaseSync(path.join(userDataDir, 'openwaggle.db'), { readOnly: true })
  try {
    const row = database
      .prepare(
        `SELECT value_json
         FROM extension_storage_items
         WHERE extension_id = ?
           AND storage_kind = 'config'
           AND storage_scope_kind = 'project'
           AND key = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(GITHUB_ISSUES_EXTENSION_ID, EXTENSION_CONFIG_KEY) as
      | { readonly value_json: string }
      | undefined
    return row ? JSON.parse(row.value_json) : null
  } finally {
    database.close()
  }
}

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
    ).toBeVisible({ timeout: EXTENSION_MOUNT_TIMEOUT })
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toHaveCount(0)

    await lifecycleButton(page, 'Trust').click()
    await expect(lifecycleButton(page, 'Enable')).toBeEnabled({
      timeout: EXTENSION_MOUNT_TIMEOUT,
    })

    await lifecycleButton(page, 'Enable').click()
    await expect(page.getByText('Reload required')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toHaveCount(0)

    await lifecycleButton(page, 'Reload').click()
    await expect(page.getByText('Reloaded')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: GITHUB_ISSUES_SETTINGS_TITLE }),
    ).toBeVisible({ timeout: EXTENSION_MOUNT_TIMEOUT })

    const settingsFrame = page.frameLocator(`iframe[title="${EXTENSION_FRAME_TITLE}"]`)
    await expect(settingsFrame.getByText('Extension configuration')).toBeVisible({
      timeout: EXTENSION_MOUNT_TIMEOUT,
    })
    await expect(settingsFrame.getByRole('heading', { name: 'GitHub Issues' })).toBeVisible({
      timeout: EXTENSION_MOUNT_TIMEOUT,
    })

    await settingsFrame.getByLabel('Repository owner').fill(SAVED_REPOSITORY_OWNER)
    await settingsFrame.getByLabel('Repository name').fill(SAVED_REPOSITORY_NAME)
    const saveConfiguration = settingsFrame.getByRole('button', { name: 'Save configuration' })
    const saveStarted = await saveConfiguration.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) {
        return false
      }
      element.click()
      return element.disabled
    })
    expect(saveStarted).toBe(true)
    await expect(saveConfiguration).toBeEnabled({ timeout: 30_000 })
    await expect
      .poll(() => readStoredConfiguration(app.userDataDir), { timeout: 30_000 })
      .toEqual({
        owner: SAVED_REPOSITORY_OWNER,
        repo: SAVED_REPOSITORY_NAME,
        labels: ['enhancement', 'ready-for-agent'],
      })

    await lifecycleButton(page, 'Disable').click()
    await expect(lifecycleButton(page, 'Enable')).toBeVisible({
      timeout: EXTENSION_MOUNT_TIMEOUT,
    })
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
