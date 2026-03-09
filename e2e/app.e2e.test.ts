import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'

test('app launches and persists a created thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    await expect(mainWindow.page.getByText('No threads yet')).toBeVisible()

    await mainWindow.createNewThread()
    await expect(mainWindow.page.getByText('No threads yet')).toBeHidden()
    await app.restart()

    await expect(app.mainWindow().page.getByText('No threads yet')).toBeHidden()
  } finally {
    await app.cleanup()
  }
})
