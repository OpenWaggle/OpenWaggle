import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { seedSingleSession } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const DIFF_ROUTE_THREAD_TITLE = 'Diff Route Test Thread'
const DIFF_ROUTE_USER_TEXT = 'diff-route-user-message'

function makeMessage(role: 'user' | 'assistant', text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    parts: [{ type: 'text', text }],
  }
}

test.describe('diff route sidebar', () => {
  test('opens and closes the diff sidebar through the route search state', async () => {
    const app = await OpenWaggleApp.launch('openwaggle-e2e-diff-route-')
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-diff-project-'))

    try {
      await seedSingleSession(app.userDataDir, {
        title: DIFF_ROUTE_THREAD_TITLE,
        updatedAt: Date.now(),
        projectPath,
        messages: [
          makeMessage('user', DIFF_ROUTE_USER_TEXT),
          makeMessage('assistant', 'Diff route response'),
        ],
      })
      await app.restart()

      const page = app.mainWindow().page
      await page.getByText(DIFF_ROUTE_THREAD_TITLE).click()
      await expect(page.getByText(DIFF_ROUTE_USER_TEXT)).toBeVisible()
      await expect(page).toHaveURL(/#\/sessions\/[0-9a-f-]+/)

      const diffToggle = page.getByRole('button', { name: 'Toggle diff panel' })
      await expect(diffToggle).toBeVisible()
      await diffToggle.click()

      await expect(page).toHaveURL(/\?panel=diff/)
      // The same route renders as a docked panel or a responsive sheet depending on available
      // viewport width. Target the outer inspector landmark: the diff can contain its own nested
      // workspace navigator, which is also correctly exposed as a complementary landmark.
      const diffAside = page
        .getByRole('complementary')
        .filter({ has: page.getByRole('button', { name: 'Close diff sidebar' }) })
      await expect(diffAside).toBeVisible()

      await page.getByRole('button', { name: 'Close diff sidebar' }).click()

      await expect(page).not.toHaveURL(/\?panel=diff/)
      await expect(diffAside).toBeHidden()
    } finally {
      await app.cleanup()
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
