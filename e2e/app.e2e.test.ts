import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

async function launchWithUserData(userDataDir: string) {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OPENHIVE_USER_DATA_DIR: userDataDir,
    },
  })
}

test('app launches and persists a created thread', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-e2e-'))
  let app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()
    await expect(window.getByText('No threads yet')).toBeVisible()

    await window.getByRole('button', { name: 'New thread' }).first().click()
    await expect(window.getByText('No threads yet')).toBeHidden()
    await app.close()

    app = await launchWithUserData(userDataDir)
    const reopenedWindow = await app.firstWindow()
    await expect(reopenedWindow.getByText('No threads yet')).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
