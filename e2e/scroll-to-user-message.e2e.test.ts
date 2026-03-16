import { test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeScrollRegressionConversation,
  SCROLL_THREAD_TITLE,
} from './support/scroll-regression-fixtures'

/**
 * Regression test: scroll-to-user-message after send.
 *
 * Seeds a conversation with: user → long assistant.
 * The long assistant response pushes the viewport far down.
 * After the user sends a second message, it must be scrolled near the
 * top of the chat scroll container — not left at the bottom.
 *
 * This tests the actual on-send scroll behavior end-to-end:
 * - scrollToUserMessageTrigger increments in the controller
 * - ChatTranscript effect fires and sets scrollTop via direct DOM
 * - The new user message ends up within PADDING_TOP px of the scroller top
 *
 * Note: in the E2E app there is no real LLM, so the optimistic user message
 * persists in the DOM briefly before TanStack may roll it back. We assert
 * the scroll position immediately after the trigger fires (within 1s).
 */
test('after sending a message, new user message is scrolled near the top', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-regression-')

  try {
    await makeScrollRegressionConversation(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(SCROLL_THREAD_TITLE)

    // Confirm seeded user message is present
    await mainWindow.expectUserMessageAttributeCount(1)

    // Capture scrollTop before send — should be at bottom (long assistant response)
    const scrollTopBefore = await app.window().evaluate(() => {
      const el = document.querySelector('[role="log"]') as HTMLElement | null
      return el?.scrollTop ?? 0
    })

    // Send a follow-up message
    await mainWindow.messageInput().fill('What about the renderer architecture?')
    await mainWindow.submitComposer()

    // After send, the new user message should be scrolled near the top.
    // The scroll is synchronous (plain DOM, no Virtuoso), so it happens within
    // one rAF after the React state update.
    await mainWindow.expectNewUserMessageScrolledToTop(scrollTopBefore)
  } finally {
    await app.cleanup()
  }
})

/**
 * Regression test: data-user-message-id attribute is present on user rows.
 * Guards the DOM structure that the scroll feature depends on.
 */
test('[data-user-message-id] attribute is present on user message rows', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-attr-')

  try {
    await makeScrollRegressionConversation(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(SCROLL_THREAD_TITLE)

    await mainWindow.expectUserMessageAttributeCount(1)
    await mainWindow.expectLastUserMessageVisible()
  } finally {
    await app.cleanup()
  }
})
