import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { seedSingleConversation } from './support/conversation-fixtures'
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
      await seedSingleConversation(app.userDataDir, {
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

      await expect(page).toHaveURL(/\?diff=1/)
      const diffAside = page.locator('aside').filter({ hasText: 'Working tree diff' })
      await expect(diffAside).toHaveAttribute('aria-hidden', 'false')
      await expect(page.getByRole('button', { name: 'Resize diff sidebar' })).toBeVisible()

      await page.getByRole('button', { name: 'Close diff sidebar' }).click()

      await expect(page).not.toHaveURL(/\?diff=1/)
      await expect(diffAside).toHaveAttribute('aria-hidden', 'true')
    } finally {
      await app.cleanup()
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
