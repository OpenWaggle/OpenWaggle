import { realpath } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import type { AgentAuthorizationScopeKey } from '../src/shared/types/agent-authorization-grants'
import { OpenWaggleApp } from './support/openwaggle-app'

const PROJECT_TITLE = 'CLI-owned project approvals'
const APPROVAL = {
  requester: 'QA approval',
  requesterId: 'qa-grant-owner',
  capability: 'mcp.tool-call',
  resource: 'qa_tool',
} satisfies AgentAuthorizationScopeKey

function recordErrors(page: Page, errors: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
}

async function openAgentAccess(app: OpenWaggleApp) {
  await app.mainWindow().openThread(PROJECT_TITLE)
  const page = app.window()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await expect(page.getByText('Saved approvals', { exact: true })).toBeVisible()
  return page
}

test('GUI project approvals and preferences persist with a CLI-owned Host', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-project-approvals-e2e-', {
    isolatedPiAgent: true,
    startHostViaCli: true,
  })
  const errors: string[] = []
  recordErrors(app.window(), errors)

  try {
    const projectPath = await realpath(app.userDataDir)
    const created = await app.runCli([
      'sessions',
      'create',
      projectPath,
      '--title',
      PROJECT_TITLE,
      '--workspace',
      'local',
      '--json',
    ])
    expect(created.stderr).toBe('')
    expect(
      await app.window().evaluate(() => ({
        hasApi: typeof window.api.grantAuthorization === 'function',
        isElectron: navigator.userAgent.includes('Electron'),
      })),
    ).toEqual({ hasApi: true, isElectron: true })

    // Both requests cross the real preload/IPC boundary. The deterministic write-race tests
    // hold a config rename; this test verifies the separate CLI Host and interactive GUI path.
    await app.window().evaluate(
      async ({ directory, key }) => {
        await Promise.all([
          window.api.grantAuthorization(directory, key),
          window.api.setProjectPreferences(directory, { authorizationMode: 'ask-for-approval' }),
        ])
      },
      { directory: projectPath, key: APPROVAL },
    )
    await app.restart()
    recordErrors(app.window(), errors)
    let page = await openAgentAccess(app)
    const revokeLabel = 'Revoke Run a tool · qa_tool for QA approval'
    await expect(page.getByRole('button', { name: revokeLabel })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Current project access mode' })).toHaveValue(
      'ask-for-approval',
    )

    await page.getByRole('button', { name: revokeLabel }).click()
    await expect(
      page.getByText('This project has no saved approvals. Approvals you keep will appear here.'),
    ).toBeVisible()
    await app.restart()
    recordErrors(app.window(), errors)
    page = await openAgentAccess(app)
    await expect(page.getByRole('button', { name: revokeLabel })).toHaveCount(0)
    await expect(
      page.getByText('This project has no saved approvals. Approvals you keep will appear here.'),
    ).toBeVisible()
    expect(
      await page.evaluate((directory) => window.api.listAuthorizationGrants(directory), projectPath),
    ).toEqual([])
    expect(
      await page.evaluate((directory) => window.api.getProjectPreferences(directory), projectPath),
    ).toMatchObject({ authorizationMode: 'ask-for-approval' })
    await page
      .getByText('This project has no saved approvals. Approvals you keep will appear here.')
      .scrollIntoViewIfNeeded()
    expect(errors).toEqual([])
    if (app.hidden) expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
  } finally {
    await app.cleanup()
  }
})
