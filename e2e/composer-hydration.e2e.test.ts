import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

test('selected slash command survives delayed session workspace hydration', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-composer-hydration-')
  try {
    const title = 'Composer hydration regression'
    const transcript = 'Hydrated workspace transcript'
    const sessionId = await seedSingleSession(app.userDataDir, {
      title, projectPath: app.userDataDir, updatedAt: Date.now(),
      messages: [{ id: 'hydration-message', role: 'assistant', createdAt: Date.now(), parts: [{ type: 'text', text: transcript }] }],
    })
    await app.restart()
    await app.installAgentSendProbe()
    const page = app.window()
    const workspace = await page.evaluate(id => window.api.getSessionWorkspace(id), sessionId)
    if (!workspace) throw new Error('Seeded session workspace is missing')
    await app.holdSessionWorkspace(workspace)
    await app.mainWindow().openThread(title)
    await page.locator('header').getByRole('button', { name: 'Toggle Session Tree' }).click()
    const tree = page.getByRole('region', { name: 'Session Tree' })
    await expect(tree.getByText(transcript, { exact: false })).toHaveCount(0)
    const input = app.mainWindow().messageInput()
    await input.fill('/vis')
    await expect(page.getByRole('menuitem', { name: /Visualize/ })).toBeVisible()
    await input.press('Enter')
    await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
    await app.releaseSessionWorkspace()
    await expect(tree.getByText(transcript, { exact: false })).toBeVisible()
    await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
    expect(await app.readAgentSendProbe()).toBeNull()
  } finally {
    await app.cleanup()
  }
})
