import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_COUNT = 70

test('idle session navigation does not exhaust browser preview owner bindings', async () => {
  test.setTimeout(180_000)
  const app = await OpenWaggleApp.launch('openwaggle-browser-owner-navigation-')
  try {
    const projectPath = path.join(app.userDataDir, 'browser-owner-project')
    await fs.mkdir(projectPath, { recursive: true })
    const sessionIds: string[] = []
    for (let index = 0; index < SESSION_COUNT; index += 1) {
      sessionIds.push(await seedSingleSession(app.userDataDir, {
        title: `Browser owner ${index + 1}`,
        projectPath,
        updatedAt: Date.now() + index,
        messages: [{
          id: `owner-message-${index}`,
          role: 'user',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: `Owner navigation fixture ${index + 1}` }],
        }],
      }))
    }
    await app.restart()
    const page = app.window()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    for (const [index, sessionId] of sessionIds.entries()) {
      // Change the real client route without reloading the renderer/owner registry.
      await page.evaluate(id => { location.hash = `/sessions/${id}` }, sessionId)
      await expect(page.getByText(`Owner navigation fixture ${index + 1}`, { exact: true })).toBeVisible()
      await expect(app.mainWindow().messageInput()).toBeVisible()
      // The chat can render before prior-owner cleanup and registration finish.
      // This check requires an existing native binding and cannot repair one.
      await expect.poll(() => page.evaluate(async id => {
        try {
          await window.api.setCurrentBrowserPreview(id, null)
          return true
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('Browser-preview owner is not registered to this renderer.')
          ) return false
          throw error
        }
      }, sessionId)).toBe(true)
    }
    await expect(page.getByText(/owner limit|owner unavailable|too many.*owner/iu)).toHaveCount(0)
    expect(errors).toEqual([])
    expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
  } finally {
    await app.cleanup()
  }
})
