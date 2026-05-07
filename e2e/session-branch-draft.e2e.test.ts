import { expect, test } from '@playwright/test'
import { seedSingleSession } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const TITLE = 'Draft branch transcript scope'
const ROOT_USER = 'Root prompt before branch'
const ROOT_ASSISTANT = 'Assistant answer before branch'
const BRANCH_POINT = 'Branch from this user node'
const MAIN_CONTINUATION = 'Main branch continuation should disappear'

test('draft branch selection shows transcript only up to the selected source node', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-branch-draft-e2e-')

  try {
    await seedSingleSession(app.userDataDir, {
      title: TITLE,
      projectPath: app.userDataDir,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'root-user',
          role: 'user',
          createdAt: Date.now() - 3,
          parts: [{ type: 'text', text: ROOT_USER }],
        },
        {
          id: 'root-assistant',
          role: 'assistant',
          createdAt: Date.now() - 2,
          parts: [{ type: 'text', text: ROOT_ASSISTANT }],
        },
        {
          id: 'branch-point',
          role: 'user',
          createdAt: Date.now() - 1,
          parts: [{ type: 'text', text: BRANCH_POINT }],
        },
        {
          id: 'main-continuation',
          role: 'assistant',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: MAIN_CONTINUATION }],
        },
      ],
    })
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(TITLE)
    await expect(mainWindow.text(MAIN_CONTINUATION)).toBeVisible()

    const branchPointRow = mainWindow.page.locator('[data-user-message-id="branch-point"]')
    await branchPointRow.hover()
    const branchButton = branchPointRow.getByTitle('Branch from message')
    await expect(branchButton).toBeVisible()
    await branchButton.click()

    await expect(mainWindow.text(ROOT_USER)).toBeVisible()
    await expect(mainWindow.text(ROOT_ASSISTANT)).toBeVisible()
    await expect(mainWindow.text(BRANCH_POINT)).toBeVisible()
    await expect(mainWindow.text(MAIN_CONTINUATION)).toBeHidden()
  } finally {
    await app.cleanup()
  }
})
