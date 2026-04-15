import crypto from 'node:crypto'
import { expect, test } from '@playwright/test'
import { seedSingleConversation } from './support/conversation-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

function makeMessage(role: 'user' | 'assistant', text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    parts: [{ type: 'text', text }],
  }
}

test.describe('inspector panels', () => {
  test('context inspector opens with visible content when clicking the header toggle', async () => {
    const app = await OpenWaggleApp.launch('openwaggle-e2e-inspector-')

    try {
      await seedSingleConversation(app.userDataDir, {
        title: 'Inspector Test Thread',
        updatedAt: Date.now(),
        messages: [makeMessage('user', 'Hello'), makeMessage('assistant', 'Hi there!')],
      })
      await app.restart()

      const page = app.mainWindow().page

      // Click on the seeded conversation to activate it
      await page.getByText('Inspector Test Thread').click()

      // Click the context inspector toggle in the header
      const contextToggle = page.getByRole('button', { name: 'Toggle context inspector' })
      await expect(contextToggle).toBeVisible()
      await contextToggle.click()

      // The context panel should show the overview with compact button
      await expect(page.getByText('Compact now')).toBeVisible({ timeout: 5_000 })

      // The context meter in the composer should exist
      const meter = page.getByRole('img', { name: 'Context usage meter' })
      await expect(meter).toBeVisible()
    } finally {
      await app.cleanup()
    }
  })

  test('context inspector toggles open and closed', async () => {
    const app = await OpenWaggleApp.launch('openwaggle-e2e-toggle-')

    try {
      await seedSingleConversation(app.userDataDir, {
        title: 'Toggle Test',
        updatedAt: Date.now(),
        messages: [makeMessage('user', 'Test'), makeMessage('assistant', 'Response')],
      })
      await app.restart()

      const page = app.mainWindow().page

      await page.getByText('Toggle Test').click()

      // Open context inspector
      await page.getByRole('button', { name: 'Toggle context inspector' }).click()
      await expect(page.getByText('Compact now')).toBeVisible({ timeout: 5_000 })

      // Close by clicking again
      await page.getByRole('button', { name: 'Toggle context inspector' }).click()
      await expect(page.getByText('Compact now')).toBeHidden({ timeout: 3_000 })
    } finally {
      await app.cleanup()
    }
  })
})
