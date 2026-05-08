import { expect, test } from '@playwright/test'
import { seedSingleSession } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

test('app launches and persists a created thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
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

test('welcome starter prompt keeps the project-selection guidance visible before project selection', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.page.getByRole('button', { name: 'Draft a one-page summary of this app' }).click()

    await mainWindow.expectComposerValue('')
    await expect(mainWindow.page.getByText('Select a project folder to get started')).toBeVisible()
    await expect(mainWindow.page.getByText('No projects yet')).toBeVisible()
  } finally {
    await app.cleanup()
  }
})
