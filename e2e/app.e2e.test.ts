import { expect, test } from '@playwright/test'
import { seedSingleConversation } from './support/conversation-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

test('app launches and persists a created thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    await expect(mainWindow.page.getByText('No threads yet')).toBeVisible()

    // Seed a conversation directly — lazy thread creation means the UI
    // button alone doesn't persist a DB row until the first message is sent.
    await seedSingleConversation(app.userDataDir, {
      title: 'Persisted Thread',
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    await expect(app.mainWindow().page.getByText('No threads yet')).toBeHidden()
  } finally {
    await app.cleanup()
  }
})

test('welcome starter prompt creates the first message without requiring a project picker', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.page.getByRole('button', { name: 'Draft a one-page summary of this app' }).click()

    await expect
      .poll(async () => {
        return mainWindow.page.evaluate(async () => {
          const apiCandidate = Reflect.get(window, 'api')
          if (!apiCandidate || typeof apiCandidate !== 'object') {
            throw new Error('window.api is unavailable')
          }

          const listConversations = Reflect.get(apiCandidate, 'listConversations')
          const getConversation = Reflect.get(apiCandidate, 'getConversation')
          if (
            typeof listConversations !== 'function' ||
            typeof getConversation !== 'function'
          ) {
            throw new Error('Conversation IPC helpers are unavailable')
          }

          const conversations = await listConversations()
          if (!Array.isArray(conversations) || conversations.length === 0) {
            return 0
          }

          const firstConversation = conversations[0]
          if (!firstConversation || typeof firstConversation !== 'object') {
            return 0
          }

          const firstConversationId = Reflect.get(firstConversation, 'id')
          if (typeof firstConversationId !== 'string') {
            return 0
          }

          const conversation = await getConversation(firstConversationId)
          if (!conversation || typeof conversation !== 'object') {
            return 0
          }

          const messages = Reflect.get(conversation, 'messages')
          return Array.isArray(messages) ? messages.length : 0
        })
      })
      .toBeGreaterThan(0)

    await expect(mainWindow.page.getByText("Let's build")).toBeHidden()
    await expect(mainWindow.threadItem('Draft a one-page summary of this app')).toBeVisible()
  } finally {
    await app.cleanup()
  }
})
