import { expect, test } from '@playwright/test'
import { seedSessions } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const FIRST_THREAD_TITLE = 'Navigation First Thread'
const SECOND_THREAD_TITLE = 'Navigation Second Thread'
const FIRST_THREAD_BODY = 'first-thread-body-visible-immediately'
const SECOND_THREAD_BODY = 'second-thread-body-visible-immediately'

test('switches threads immediately from the preloaded session read model', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-thread-nav-e2e-')

  try {
    await seedSessions(app.userDataDir, [
      {
        title: FIRST_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: Date.now() - 1,
        messages: [
          {
            id: 'first-message',
            role: 'user',
            createdAt: Date.now() - 1,
            parts: [{ type: 'text', text: FIRST_THREAD_BODY }],
          },
        ],
      },
      {
        title: SECOND_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: Date.now(),
        messages: [
          {
            id: 'second-message',
            role: 'user',
            createdAt: Date.now(),
            parts: [{ type: 'text', text: SECOND_THREAD_BODY }],
          },
        ],
      },
    ])
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(FIRST_THREAD_TITLE)
    const firstBodyText = await mainWindow.page.locator('body').textContent()
    expect(firstBodyText).toContain(FIRST_THREAD_BODY)
    expect(firstBodyText).not.toContain(SECOND_THREAD_BODY)

    await mainWindow.openThread(SECOND_THREAD_TITLE)
    const secondBodyText = await mainWindow.page.locator('body').textContent()
    expect(secondBodyText).toContain(SECOND_THREAD_BODY)
    expect(secondBodyText).not.toContain(FIRST_THREAD_BODY)
    expect(secondBodyText).not.toContain("Let's build")
  } finally {
    await app.cleanup()
  }
})
