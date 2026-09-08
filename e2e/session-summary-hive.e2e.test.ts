import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessionLineage, seedSessions } from './support/session-fixtures'

const QUEEN_TITLE = 'Hive queen session'
const ACTIVE_WORKER_TITLE = 'Hive active worker'
const DONE_WORKER_TITLE = 'Hive done worker'
const ARCHIVED_WORKER_TITLE = 'Hive archived worker'
const GRANDCHILD_TITLE = 'Hive grandchild worker'

function seededMessage(id: string, text: string, createdAt: number) {
  return { id, role: 'user' as const, parts: [{ type: 'text', text }], createdAt }
}

test('Session Summary Hive shows only the opened session direct lineage and remains navigable', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-hive-')
  try {
    const now = Date.now()
    const [queenId, activeWorkerId, doneWorkerId, archivedWorkerId, grandchildId] =
      await seedSessions(app.userDataDir, [
        {
          title: QUEEN_TITLE,
          updatedAt: now,
          messages: [seededMessage('hive-queen-user', 'Coordinate this Hive.', now)],
        },
        {
          title: ACTIVE_WORKER_TITLE,
          updatedAt: now - 1,
          messages: [seededMessage('hive-active-user', 'Work in progress.', now - 1)],
        },
        {
          title: DONE_WORKER_TITLE,
          updatedAt: now - 2,
          messages: [seededMessage('hive-done-user', 'Work completed.', now - 2)],
        },
        {
          title: ARCHIVED_WORKER_TITLE,
          updatedAt: now - 3,
          archived: true,
          messages: [seededMessage('hive-archived-user', 'Archived work.', now - 3)],
        },
        {
          title: GRANDCHILD_TITLE,
          updatedAt: now - 4,
          messages: [seededMessage('hive-grandchild-user', 'Nested work.', now - 4)],
        },
      ])

    if (!queenId || !activeWorkerId || !doneWorkerId || !archivedWorkerId || !grandchildId) {
      throw new Error('Hive fixture did not create every expected session')
    }

    await seedSessionLineage(app.userDataDir, [
      {
        sessionId: activeWorkerId,
        parentSessionId: queenId,
        agentDefinitionName: 'implementation-worker',
        delegationState: 'working',
        updatedAt: now - 1,
      },
      {
        sessionId: doneWorkerId,
        parentSessionId: queenId,
        agentDefinitionName: 'review-worker',
        delegationState: 'accepted',
        updatedAt: now - 2,
      },
      {
        sessionId: archivedWorkerId,
        parentSessionId: queenId,
        agentDefinitionName: 'archived-worker',
        delegationState: 'cancelled',
        updatedAt: now - 3,
      },
      {
        sessionId: grandchildId,
        parentSessionId: activeWorkerId,
        agentDefinitionName: 'nested-worker',
        delegationState: 'working',
        updatedAt: now - 4,
      },
    ])

    await app.restart()
    await app.resizeMainWindow(1_800, 850)
    const page = app.window()
    await app.mainWindow().openThread(QUEEN_TITLE)

    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    const hive = summary.getByRole('region', { name: 'Hive' })
    await expect(hive).toBeVisible()
    await expect(hive.getByRole('button', { name: /^Hive \d/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(hive).toContainText('1 active · 3 total')
    await expect(hive.getByRole('group', { name: 'Active Hive sessions' })).toContainText(
      ACTIVE_WORKER_TITLE,
    )
    await expect(hive.getByRole('group', { name: 'Done Hive sessions' })).toContainText(
      DONE_WORKER_TITLE,
    )
    await expect(hive.getByRole('group', { name: 'Archived Hive sessions' })).toContainText(
      ARCHIVED_WORKER_TITLE,
    )
    await expect(hive.getByText(GRANDCHILD_TITLE)).toHaveCount(0)
    await app.captureEvidence('hive-compatibility-current-projection')

    await hive.getByRole('button', { name: new RegExp(ACTIVE_WORKER_TITLE) }).click()
    await expect(page.locator('[data-qa="header-session-title"]')).toHaveText(
      ACTIVE_WORKER_TITLE,
    )
    const workerHive = page
      .getByRole('complementary', { name: 'Session Summary' })
      .getByRole('region', { name: 'Hive' })
    await expect(workerHive.getByRole('button', { name: new RegExp(QUEEN_TITLE) })).toBeVisible()
    await expect(workerHive.getByText(DONE_WORKER_TITLE)).toHaveCount(0)

    await workerHive.getByRole('button', { name: new RegExp(QUEEN_TITLE) }).click()
    await expect(page.locator('[data-qa="header-session-title"]')).toHaveText(QUEEN_TITLE)

    await app.confirmNativeDialogs(1)
    const queenRow = page
      .locator('[data-qa="sidebar-session-row"]')
      .filter({ hasText: QUEEN_TITLE })
    await queenRow.getByRole('button', { name: `Open session actions for ${QUEEN_TITLE}` }).click()
    await page.getByRole('button', { name: 'Delete session' }).click()

    await expect(page.getByText(/Failed to delete session:.*Workers.*Queen session/u)).toBeVisible()
    await expect(page.locator('[data-qa="header-session-title"]')).toHaveText(QUEEN_TITLE)
    await expect(queenRow).toBeVisible()
    await expect(hive).toContainText('1 active · 3 total')
    await app.captureEvidence('session-summary-hive-queen-delete-blocked')
  } finally {
    await app.cleanup()
  }
})
