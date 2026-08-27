import { expect, test } from '@playwright/test'
import { seedSingleSession } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

test('app launches and persists a created thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    if (app.hidden) {
      await expect(app.desktopState()).resolves.toEqual({
        active: false,
        focused: false,
        visible: false,
      })
      await expect(app.desktopPolicyProbe()).resolves.toEqual({
        baseConstructedVisible: false,
        baseFocusBlocked: true,
        baseShowBlocked: true,
        constructedVisible: false,
        focusBlocked: true,
        showBlocked: true,
      })
    }
    const mainWindow = app.mainWindow()
    await expect(mainWindow.page.getByText('No projects yet')).toBeVisible()

    // Seed a session directly — lazy thread creation means the UI
    // button alone doesn't persist a DB row until the first message is sent.
    await seedSingleSession(app.userDataDir, {
      title: 'Persisted Thread',
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    await expect(app.mainWindow().page.getByText('Persisted Thread')).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('welcome keeps the centered project guidance and removes starter cards', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    const welcome = mainWindow.page.getByRole('region', { name: 'Welcome' })
    await expect(welcome).toBeVisible()
    await expect(welcome.getByRole('img', { name: 'OpenWaggle logo' })).toBeVisible()
    await mainWindow.expectComposerValue('')
    await expect(mainWindow.page.getByText('Select a project folder to get started')).toBeVisible()
    await expect(mainWindow.page.getByText('No projects yet')).toBeVisible()
    await expect(
      mainWindow.page.getByRole('button', { name: 'Draft a one-page summary of this app' }),
    ).toHaveCount(0)
    await expect(
      mainWindow.page.getByRole('button', { name: 'Build a coding game in this repo' }),
    ).toHaveCount(0)
    await expect(
      mainWindow.page.getByRole('button', { name: 'Create a refactor plan for this codebase' }),
    ).toHaveCount(0)
  } finally {
    await app.cleanup()
  }
})
