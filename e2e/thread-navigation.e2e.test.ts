import { expect, test } from '@playwright/test'
import { seedSessions } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const FIRST_THREAD_TITLE = 'Navigation First Thread'
const SECOND_THREAD_TITLE = 'Navigation Second Thread'
const FIRST_THREAD_BODY = 'first-thread-body-visible-immediately'
const SECOND_THREAD_BODY = 'second-thread-body-visible-immediately'
const TOOL_THREAD_TITLE = 'Nav Tool Thread'
const TOOL_THREAD_USER_BODY = 'tool-thread-user-body-visible-after-switch'
const TOOL_THREAD_ASSISTANT_BODY = 'tool-thread-assistant-body-visible-after-switch'
const TOOL_THREAD_PATH = 'src/navigation-persisted.ts'
const TOOL_THREAD_LABEL = `Requested read ${TOOL_THREAD_PATH}`
const TOOL_CALL_ID = 'tool-navigation-read'
const TOOL_DETAILS_LABEL = 'Show 1 tool call'
const SHARED_PROMPT = 'Draft a one-page summary of this app'
const FIRST_SHARED_ASSISTANT = 'first shared prompt assistant response'
const SECOND_SHARED_ASSISTANT = 'second shared prompt assistant response'

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

test('keeps assistant text and tool calls visible after switching away and back', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-thread-transcript-e2e-')

  try {
    const now = Date.now()
    await seedSessions(app.userDataDir, [
      {
        title: TOOL_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: now - 1,
        messages: [
          {
            id: 'tool-thread-user-message',
            role: 'user',
            createdAt: now - 2,
            parts: [{ type: 'text', text: TOOL_THREAD_USER_BODY }],
          },
          {
            id: 'tool-thread-assistant-message',
            role: 'assistant',
            createdAt: now - 1,
            parts: [
              {
                type: 'tool-call',
                toolCall: {
                  id: TOOL_CALL_ID,
                  name: 'read',
                  args: { path: TOOL_THREAD_PATH },
                  state: 'input-complete',
                },
              },
              {
                type: 'text',
                text: TOOL_THREAD_ASSISTANT_BODY,
              },
            ],
          },
        ],
      },
      {
        title: SECOND_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: now,
        messages: [
          {
            id: 'second-message-for-tool-switch',
            role: 'user',
            createdAt: now,
            parts: [{ type: 'text', text: SECOND_THREAD_BODY }],
          },
        ],
      },
    ])
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(TOOL_THREAD_TITLE)
    await expect(mainWindow.page.getByText(TOOL_THREAD_ASSISTANT_BODY)).toBeVisible()
    await expect(mainWindow.page.getByText(TOOL_DETAILS_LABEL)).toBeVisible()
    await mainWindow.page.getByText(TOOL_DETAILS_LABEL).click()
    await expect(mainWindow.page.getByText(TOOL_THREAD_LABEL)).toBeVisible()

    await mainWindow.openThread(SECOND_THREAD_TITLE)
    await expect(mainWindow.page.getByText(SECOND_THREAD_BODY)).toBeVisible()
    await expect(mainWindow.page.getByText(TOOL_THREAD_ASSISTANT_BODY)).toBeHidden()
    await expect(mainWindow.page.getByText(TOOL_THREAD_LABEL)).toBeHidden()

    await mainWindow.openThread(TOOL_THREAD_TITLE)
    await expect(mainWindow.page.getByText(TOOL_THREAD_ASSISTANT_BODY)).toBeVisible()
    await expect(mainWindow.page.getByText(TOOL_DETAILS_LABEL)).toBeVisible()
    await mainWindow.page.getByText(TOOL_DETAILS_LABEL).click()
    await expect(mainWindow.page.getByText(TOOL_THREAD_LABEL)).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('keeps identical-prompt transcripts isolated during rapid switching', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-identical-prompt-switch-e2e-')

  try {
    const now = Date.now()
    await seedSessions(app.userDataDir, [
      {
        title: 'Shared Prompt First Thread',
        projectPath: app.userDataDir,
        updatedAt: now - 1,
        messages: [
          {
            id: 'shared-first-user',
            role: 'user',
            createdAt: now - 2,
            parts: [{ type: 'text', text: SHARED_PROMPT }],
          },
          {
            id: 'shared-first-assistant',
            role: 'assistant',
            createdAt: now - 1,
            parts: [{ type: 'text', text: FIRST_SHARED_ASSISTANT }],
          },
        ],
      },
      {
        title: 'Shared Prompt Second Thread',
        projectPath: app.userDataDir,
        updatedAt: now,
        messages: [
          {
            id: 'shared-second-user',
            role: 'user',
            createdAt: now - 2,
            parts: [{ type: 'text', text: SHARED_PROMPT }],
          },
          {
            id: 'shared-second-assistant',
            role: 'assistant',
            createdAt: now,
            parts: [{ type: 'text', text: SECOND_SHARED_ASSISTANT }],
          },
        ],
      },
    ])
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread('Shared Prompt First Thread')
    await expect(mainWindow.page.getByText(FIRST_SHARED_ASSISTANT)).toBeVisible()
    await expect(mainWindow.page.getByText(SECOND_SHARED_ASSISTANT)).toBeHidden()

    await mainWindow.openThread('Shared Prompt Second Thread')
    await expect(mainWindow.page.getByText(SECOND_SHARED_ASSISTANT)).toBeVisible()
    await expect(mainWindow.page.getByText(FIRST_SHARED_ASSISTANT)).toBeHidden()

    await mainWindow.openThread('Shared Prompt First Thread')
    await expect(mainWindow.page.getByText(FIRST_SHARED_ASSISTANT)).toBeVisible()
    await expect(mainWindow.page.getByText(SECOND_SHARED_ASSISTANT)).toBeHidden()
  } finally {
    await app.cleanup()
  }
})
