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
const OTHER_SESSION_TITLE = 'Extension host isolation session'
const SEEDED_MESSAGE_TEXT = 'extension-host-proof-project'
const EXTENSION_FRAME_TITLE = `Extension module: ${GITHUB_ISSUES_SETTINGS_TITLE}`
const SAVED_REPOSITORY_OWNER = 'OpenWaggle-e2e'
const SAVED_REPOSITORY_NAME = 'OpenWaggle-e2e-fixture'
const EXTENSION_CONFIG_KEY = 'github.issues.config'

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
  const projectPath = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-project-')),
  )

  try {
    await installProjectExtensionFixture({
      projectPath,
      extensionId: GITHUB_ISSUES_EXTENSION_ID,
    })
    const seededSessionId = await seedSingleSession(app.userDataDir, {
      title: SEEDED_SESSION_TITLE,
      updatedAt: Date.now(),
      projectPath,
      messages: [seededProjectMessage()],
    })
    const otherSessionId = await seedSingleSession(app.userDataDir, {
      title: OTHER_SESSION_TITLE,
      updatedAt: Date.now() - 1,
      projectPath,
      messages: [
        {
          ...seededProjectMessage(),
          id: 'extension-host-isolation-message',
          parts: [{ type: 'text', text: 'extension-host-isolation-project' }],
        },
      ],
    })
    await setActiveProjectForExtensionQa(app.window(), projectPath)
    await app.restart()

    const page = app.window()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location()
        consoleErrors.push(
          location.url.length > 0 ? `${message.text()} (${location.url})` : message.text(),
        )
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

    const extensionPanelUrl = new URL(page.url())
    extensionPanelUrl.hash = `#/sessions/${seededSessionId}?panel=extension-side-panel&sidePanelExtensionId=${GITHUB_ISSUES_EXTENSION_ID}&sidePanelId=github.resources`
    await page.goto(extensionPanelUrl.toString())
    const resourceContribution = await page.evaluate(
      async ({ extensionId, projectPath: requestedProjectPath, sessionId }) => {
        const registry = await window.api.listExtensionContributions({
          projectPaths: [requestedProjectPath],
          sessionId,
        })
        return registry.entries.find(
          (entry) =>
            entry.extensionId === extensionId && entry.contributionId === 'github.resources',
        )
      },
      {
        extensionId: GITHUB_ISSUES_EXTENSION_ID,
        projectPath,
        sessionId: seededSessionId,
      },
    )
    expect(resourceContribution).toMatchObject({
      projectPaths: [projectPath],
      sessionId: seededSessionId,
      eligibility: {
        enabled: true,
        trusted: true,
        runtimeEnabled: true,
      },
    })
    const resourcesFrame = page.frameLocator(
      'iframe[title="Extension module: GitHub Session Resources"]',
    )
    const publishReport = resourcesFrame.getByRole('button', { name: 'Publish session report' })
    await expect(resourcesFrame.getByText('Ready to publish to this session.')).toBeVisible()
    await publishReport.click()
    await expect(resourcesFrame.getByText('Published to Outputs.')).toBeVisible()
    await expect(publishReport).toBeEnabled()
    await page.getByRole('button', { name: 'Close extension side panel' }).click()

    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    await summary.getByRole('button', { name: /Outputs/ }).click()
    await expect(summary.getByText('GitHub session report')).toBeVisible()
    const [baseUrl] = page.url().split('#')
    await page.goto(`${baseUrl}#/sessions/${otherSessionId}`)
    await expect(page.getByText(OTHER_SESSION_TITLE).first()).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'Session Summary' }).getByText('GitHub session report'),
    ).toHaveCount(0)

    await openExtensionsSettings(page)

    await lifecycleButton(page, 'Disable').click()
    await expect(lifecycleButton(page, 'Enable')).toBeVisible({ timeout: 30_000 })
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
