import { expect, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

async function expectHeaderFits(page: Page) {
  const geometry = await page.evaluate(() => {
    const title = document.querySelector('[data-qa="header-session-title"]')?.getBoundingClientRect()
    const actions = document.querySelector('[data-qa="header-actions"]')?.getBoundingClientRect()
    if (!title || !actions) throw new Error('Session header geometry is missing.')
    return { titleWidth: title.width, titleRight: title.right, actionsLeft: actions.left, actionsRight: actions.right, width: innerWidth }
  })
  expect(geometry.titleWidth).toBeGreaterThan(0)
  expect(geometry.titleRight).toBeLessThanOrEqual(geometry.actionsLeft)
  expect(geometry.actionsRight).toBeLessThanOrEqual(geometry.width)
  await expect(page.getByRole('button', { name: 'Toggle diff panel', exact: true })).toBeVisible()
}

test('session navigation keeps its title and actions visible at compact header widths', async ({}, testInfo) => {
  const app = await OpenWaggleApp.launch('openwaggle-header-navigation-')
  try {
    const title = 'Responsive session navigation'
    const sessionId = await seedSingleSession(app.userDataDir, {
      title,
      projectPath: app.userDataDir,
      updatedAt: Date.now(),
      messages: [{ id: 'responsive-header-message', role: 'user', createdAt: Date.now(), parts: [{ type: 'text', text: 'Responsive header fixture' }] }],
    })
    await app.restart()
    const page = app.window()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    // 800 is the native minimum window width; smaller requests are clamped by Electron.
    for (const width of [800, 1024, 1184, 1600]) {
      await app.resizeMainContent(width, 700)
      await app.mainWindow().openThread(title)
      await expect(page.locator('[data-chat-route-session-id]')).toHaveAttribute('data-chat-route-session-id', sessionId)
      await expect(page.getByText('Responsive header fixture', { exact: true })).toBeVisible()
      await expectHeaderFits(page)
      await page.keyboard.press(`${modifier}+B`)
      await expect(page.getByRole('navigation', { name: 'Sidebar', exact: true })).toBeHidden()
      await expectHeaderFits(page)
      if (width === 800) await testInfo.attach('header-sidebar-collapsed', { path: await app.captureEvidence('header-sidebar-collapsed'), contentType: 'image/png' })
      await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Sidebar', exact: true })).toBeVisible()
      await expectHeaderFits(page)
      await testInfo.attach(`header-session-navigation-${width}`, { path: await app.captureEvidence(`header-session-navigation-${width}`), contentType: 'image/png' })
    }
    expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
  } finally {
    await app.cleanup()
  }
})
