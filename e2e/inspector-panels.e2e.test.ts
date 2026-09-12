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
      // Exercise both layouts on every platform, independent of runner DPI or screen size.
      for (const [width, layoutMarker] of [
        [1440, 'data-right-sidebar-shell'],
        [1000, 'data-right-sidebar-panel'],
      ] as const) {
        await page.setViewportSize({ width, height: 900 })
        await expect(diffToggle).toBeVisible()
        await diffToggle.click()

        await expect(page).toHaveURL(/\?panel=diff/)
        const closeDiff = page.getByRole('button', { name: 'Close diff sidebar' })
        // Summary and the workspace navigator also have complementary landmarks.
        const diffAside = page.locator(`[${layoutMarker}="true"]`).filter({ has: closeDiff })
        await expect(diffAside).toBeVisible()
        await expect(diffAside).toHaveAttribute(layoutMarker, 'true')

        await closeDiff.click()

        await expect(page).not.toHaveURL(/\?panel=diff/)
        await expect(diffAside).toBeHidden()
        await expect(closeDiff).toHaveCount(0)
        // Closing must retain content for its animation without exposing its controls.
        const retainedPanel = page.locator('[data-right-sidebar-panel="true"]')
        await expect(retainedPanel).toBeAttached()
        expect(await retainedPanel.evaluate((panel) => panel.closest('[inert]') !== null)).toBe(true)

        await diffToggle.focus()
        await page.keyboard.press('Tab')
        expect(
          await page.evaluate(() => document.activeElement?.closest('[inert]') ?? null),
        ).toBeNull()
      }
    } finally {
      await app.cleanup()
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
