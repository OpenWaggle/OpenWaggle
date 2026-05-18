import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

const SOURCE_PROJECT_LABEL = 'draft-source-repo'
const TARGET_PROJECT_LABEL = 'draft-target-repo'
const SOURCE_THREAD_TITLE = 'Source Existing Conversation'
const TARGET_THREAD_TITLE = 'Target Existing Conversation'
const SOURCE_THREAD_BODY = 'source-transcript-body-before-draft'
const TARGET_THREAD_BODY = 'target-transcript-body-before-draft'

test('project-level new session opens a draft in the selected repository', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-project-draft-e2e-')

  try {
    const sourceProjectPath = path.join(app.userDataDir, SOURCE_PROJECT_LABEL)
    const targetProjectPath = path.join(app.userDataDir, TARGET_PROJECT_LABEL)
    await fs.mkdir(sourceProjectPath, { recursive: true })
    await fs.mkdir(targetProjectPath, { recursive: true })

    await seedSessions(app.userDataDir, [
      {
        title: SOURCE_THREAD_TITLE,
        projectPath: sourceProjectPath,
        updatedAt: Date.now() - 2,
        messages: [
          {
            id: 'source-message',
            role: 'user',
            createdAt: Date.now() - 2,
            parts: [{ type: 'text', text: SOURCE_THREAD_BODY }],
          },
        ],
      },
      {
        title: TARGET_THREAD_TITLE,
        projectPath: targetProjectPath,
        updatedAt: Date.now() - 1,
        messages: [
          {
            id: 'target-message',
            role: 'user',
            createdAt: Date.now() - 1,
            parts: [{ type: 'text', text: TARGET_THREAD_BODY }],
          },
        ],
      },
    ])
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(SOURCE_THREAD_TITLE)
    await expect(mainWindow.page.getByText(SOURCE_THREAD_BODY)).toBeVisible()

    await mainWindow.page
      .getByRole('button', { name: `Collapse ${TARGET_PROJECT_LABEL}` })
      .hover()
    await mainWindow.page.getByRole('button', { name: `New session in ${TARGET_PROJECT_LABEL}` }).click()

    await expect(
      mainWindow.page.getByRole('button', { name: `Draft session in ${TARGET_PROJECT_LABEL}` }),
    ).toBeVisible()
    await expect(mainWindow.page.getByText("Let's build")).toBeVisible()
    await expect(mainWindow.page.getByTitle('Open project picker')).toContainText(
      TARGET_PROJECT_LABEL,
    )
    await expect(mainWindow.page.getByText(SOURCE_THREAD_BODY)).toBeHidden()
    await expect(mainWindow.page.getByText(TARGET_THREAD_BODY)).toBeHidden()
  } finally {
    await app.cleanup()
  }
})
