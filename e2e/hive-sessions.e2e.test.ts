import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedHive } from './support/session-fixtures'

const QUEEN_TITLE = 'Coordinate Session Host release'
const ACTIVE_WORKER_TITLE = 'Verify cross-session control'
const DONE_WORKER_TITLE = 'Document Hive vocabulary'
const ARCHIVED_WORKER_TITLE = 'Archived search investigation'

function emptySession(title: string, updatedAt: number) {
  return { title, updatedAt, messages: [] }
}

test('Hive Sessions stay ordinary sidebar sessions with reciprocal composer navigation', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-hive-sessions-e2e-')

  try {
    const now = Date.now()
    await seedHive(app.userDataDir, emptySession(QUEEN_TITLE, now), [
      {
        ...emptySession(ACTIVE_WORKER_TITLE, now - 1),
        delegationState: 'ready_for_review',
        agentDefinitionName: 'release-verifier',
      },
      {
        ...emptySession(DONE_WORKER_TITLE, now - 2),
        delegationState: 'accepted',
      },
      {
        ...emptySession(ARCHIVED_WORKER_TITLE, now - 3),
        delegationState: 'needs_attention',
        archived: true,
      },
    ])
    await app.restart()

    const page = app.window()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const row = (title: string) =>
      page.locator('[data-qa="sidebar-session-row"]').filter({ hasText: title })

    await expect(row(QUEEN_TITLE)).toBeVisible()
    await expect(row(ACTIVE_WORKER_TITLE)).toBeVisible()
    await expect(row(DONE_WORKER_TITLE)).toBeVisible()
    await expect(row(ARCHIVED_WORKER_TITLE)).toHaveCount(0)
    await expect(
      row(QUEEN_TITLE).locator(
        '[data-qa="sidebar-row-line2"] [data-qa="sidebar-session-lineage"]',
      ),
    ).toHaveAttribute('title', 'Queen Session · 3 direct Workers')
    await expect(
      row(ACTIVE_WORKER_TITLE).locator(
        '[data-qa="sidebar-row-line2"] [data-qa="sidebar-session-lineage"]',
      ),
    ).toHaveAttribute(
      'title',
      `Worker Session · Parent: ${QUEEN_TITLE} · Agent: release-verifier`,
    )

    await row(QUEEN_TITLE).click()
    await expect(page.locator('header').getByText('Queen', { exact: true })).toBeVisible()
    await expect(
      page.locator('[data-qa="header-session-main"] [data-qa="header-session-identity"]'),
    ).toHaveCount(0)
    const hive = page.getByRole('region', { name: 'Hive Sessions' })
    await expect(hive).toBeVisible()
    await expect(hive.getByText('3 total')).toBeVisible()
    await expect(hive.getByText(ACTIVE_WORKER_TITLE)).toBeVisible()
    await expect(hive.getByText(DONE_WORKER_TITLE)).toBeVisible()
    await expect(hive.getByText('Archived · 1')).toBeVisible()
    await expect(hive.getByText(ARCHIVED_WORKER_TITLE)).toHaveCount(0)

    await hive.getByRole('button', { name: 'Expand archived Workers' }).click()
    await expect(hive.getByText(ARCHIVED_WORKER_TITLE)).toBeVisible()

    await hive.getByRole('button', { name: `Open Worker Session: ${ACTIVE_WORKER_TITLE}` }).click()
    await expect(page.locator('header').getByText('Worker', { exact: true })).toBeVisible()
    await expect(page.locator('header').getByText('release-verifier', { exact: false })).toBeVisible()
    const parentShortcut = hive.getByRole('button', {
      name: `Open parent Session: ${QUEEN_TITLE}`,
    })
    await expect(parentShortcut).toBeVisible()
    await expect(parentShortcut.getByText('Parent', { exact: true })).toBeVisible()
    await expect(parentShortcut.getByText(QUEEN_TITLE, { exact: true })).toBeVisible()

    await parentShortcut.click()
    await expect(page.locator('header').getByText('Queen', { exact: true })).toBeVisible()
    await hive.getByRole('button', { name: 'Collapse Hive Sessions' }).click()
    await expect(hive.getByText(ACTIVE_WORKER_TITLE)).toHaveCount(0)
    await expect(hive.getByRole('button', { name: 'Expand Hive Sessions' })).toBeVisible()
    await hive.getByRole('button', { name: 'Expand Hive Sessions' }).click()
    await expect(hive.getByText(ACTIVE_WORKER_TITLE)).toBeVisible()
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('Sessions CLI mutations update an open GUI through the Session Host event stream', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-cli-sync-e2e-')

  try {
    const title = 'Created by external agent CLI'
    const created = await app.runCli([
      'sessions',
      'create',
      app.userDataDir,
      '--title',
      title,
      '--workspace',
      'local',
      '--json',
    ])
    expect(created.stderr).toBe('')
    const payload: unknown = JSON.parse(created.stdout)
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('result' in payload) ||
      typeof payload.result !== 'object' ||
      payload.result === null ||
      !('response' in payload.result) ||
      typeof payload.result.response !== 'object' ||
      payload.result.response === null ||
      !('outcome' in payload.result.response) ||
      typeof payload.result.response.outcome !== 'object' ||
      payload.result.response.outcome === null ||
      !('sessionId' in payload.result.response.outcome) ||
      typeof payload.result.response.outcome.sessionId !== 'string'
    ) {
      throw new Error(`Unexpected Sessions CLI response: ${created.stdout}`)
    }

    const row = app
      .window()
      .locator('[data-qa="sidebar-session-row"]')
      .filter({ hasText: title })
    await expect(row).toBeVisible()

    const renamedTitle = 'Renamed by external agent CLI'
    const renamed = await app.runCli([
      'sessions',
      'rename',
      payload.result.response.outcome.sessionId,
      renamedTitle,
      '--json',
    ])
    expect(renamed.stderr).toBe('')
    await expect(
      app.window().locator('[data-qa="sidebar-session-row"]').filter({ hasText: renamedTitle }),
    ).toBeVisible()
    await expect(row).toHaveCount(0)
  } finally {
    await app.cleanup()
  }
})
