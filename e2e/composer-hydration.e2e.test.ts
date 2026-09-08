import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

test('unsent text and slash chips survive responsive sidebar mode changes', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-composer-responsive-')
  try {
    const title = 'Responsive draft retention'
    await seedSingleSession(app.userDataDir, {
      title, projectPath: app.userDataDir, updatedAt: Date.now(),
      messages: [{ id: 'responsive-message', role: 'assistant', createdAt: Date.now(), parts: [{ type: 'text', text: 'Responsive workspace ready' }] }],
    })
    await app.restart()
    await app.resizeMainContent(1800, 900)
    await app.installAgentSendProbe()
    await app.mainWindow().openThread(title)
    const page = app.window()
    const input = app.mainWindow().messageInput()
    await input.fill('/vis')
    await expect(page.getByRole('menuitem', { name: /Visualize/ })).toBeVisible()
    await input.press('Enter')
    await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
    await input.pressSequentially('Unsent responsive draft')
    for (const width of [760, 1800, 760, 1800]) {
      await app.resizeMainContent(width, 900)
      await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
      await expect(input).toContainText('Unsent responsive draft')
      await expect(input).toBeFocused()
    }
    expect(await app.readAgentSendProbe()).toBeNull()
  } finally {
    await app.cleanup()
  }
})

test('selected slash command survives delayed project selection and session workspace hydration', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-composer-hydration-')
  try {
    const title = 'Composer hydration regression'
    const transcript = 'Hydrated workspace transcript'
    const sessionId = await seedSingleSession(app.userDataDir, {
      title, projectPath: app.userDataDir, updatedAt: Date.now(),
      messages: [{ id: 'hydration-message', role: 'assistant', createdAt: Date.now(), parts: [{ type: 'text', text: transcript }] }],
    })
    await app.restart()
    // Keep Session Tree docked so its narrow-screen modal does not make the composer inert.
    await app.resizeMainContent(1800, 900)
    await app.installAgentSendProbe()
    const page = app.window()
    const workspace = await page.evaluate(id => window.api.getSessionWorkspace(id), sessionId)
    if (!workspace) throw new Error('Seeded session workspace is missing')
    await app.holdSessionWorkspace(workspace)
    await app.holdProjectSelection(app.userDataDir)
    await app.mainWindow().openThread(title)
    await page.locator('header').getByRole('button', { name: 'Toggle Session Tree' }).click()
    const tree = page.getByRole('region', { name: 'Session Tree' })
    await expect(tree.getByText(transcript, { exact: false })).toHaveCount(0)
    const input = app.mainWindow().messageInput()
    await input.fill('/vis')
    await expect(page.getByRole('menuitem', { name: /Visualize/ })).toBeVisible()
    await input.press('Enter')
    await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
    await app.releaseProjectSelection()
    await expect.poll(() => app.projectSelectionApplied()).toBe(true)
    await app.releaseSessionWorkspace()
    await expect(tree.getByText(transcript, { exact: false })).toBeVisible()
    await expect(input.locator('[title="/visualize"]')).toContainText('Visualize')
    expect(await app.readAgentSendProbe()).toBeNull()
  } finally {
    await app.cleanup()
  }
})

test('clearing a pending composer does not resurrect a saved branch draft', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-composer-cleared-hydration-')
  try {
    const title = 'Cleared pending draft'
    const transcript = 'Cleared draft workspace ready'
    const sessionId = await seedSingleSession(app.userDataDir, {
      title, projectPath: app.userDataDir, updatedAt: Date.now(),
      messages: [{ id: 'cleared-hydration-message', role: 'assistant', createdAt: Date.now(), parts: [{ type: 'text', text: transcript }] }],
    })
    await app.restart()
    await app.resizeMainContent(1800, 900)
    await app.installAgentSendProbe()
    const page = app.window()
    const main = app.mainWindow()
    await main.openThread(title)
    await page.locator('header').getByRole('button', { name: 'Toggle Session Tree' }).click()
    const tree = page.getByRole('region', { name: 'Session Tree' })
    await expect(tree.getByText(transcript, { exact: false })).toBeVisible()
    await main.messageInput().fill('Old saved branch draft')
    await main.createNewThread()
    await expect(main.messageInput()).toHaveText('')
    const workspace = await page.evaluate(id => window.api.getSessionWorkspace(id), sessionId)
    if (!workspace) throw new Error('Seeded session workspace is missing')
    await app.holdSessionWorkspace(workspace)
    await main.openThread(title)
    await page.locator('header').getByRole('button', { name: 'Toggle Session Tree' }).click()
    await expect(tree.getByText(transcript, { exact: false })).toHaveCount(0)
    await main.messageInput().fill('Temporary pending edit')
    // Lexical's selection can race fill('')'s synthetic delete under CPU contention.
    // Exercise the user keyboard path and prove the clear happened before hydration.
    await main.messageInput().press('ControlOrMeta+A')
    await main.messageInput().press('Backspace')
    await expect(main.messageInput()).toHaveText('')
    await app.releaseSessionWorkspace()
    await expect(tree.getByText(transcript, { exact: false })).toBeVisible()
    await expect(main.messageInput()).toHaveText('')
    expect(await app.readAgentSendProbe()).toBeNull()
  } finally {
    await app.cleanup()
  }
})
