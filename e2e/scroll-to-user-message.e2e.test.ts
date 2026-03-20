import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeThreadNavigationScrollConversations,
  makeScrollRegressionConversation,
  NAV_SCROLL_THREAD_TITLE_A,
  NAV_SCROLL_THREAD_TITLE_B,
  NAV_THREAD_B_USER_MARKER,
  SCROLL_THREAD_TITLE,
} from './support/scroll-regression-fixtures'

const SCROLL_RESTORE_TOLERANCE_PX = 16

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

test('thread navigation restores per-thread scroll and does not jump to user-anchor (including restart)', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-navigation-')

  try {
    await makeThreadNavigationScrollConversations(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_A)
    await mainWindow.expectLastUserMessageVisible()

    await app.window().locator('[role="log"]').hover()
    for (let i = 0; i < 4; i += 1) {
      await app.window().mouse.wheel(0, 1200)
    }

    const customScrollTop = await app.window().evaluate(() => {
      const scroller = document.querySelector('[role="log"]')
      if (!(scroller instanceof HTMLElement)) {
        throw new Error('Chat scroller not found')
      }
      return scroller.scrollTop
    })
    if (customScrollTop < 80) {
      throw new Error(`Expected a scrolled position after wheel input, got ${String(customScrollTop)}`)
    }

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_B)
    await mainWindow.expectTextVisible(NAV_THREAD_B_USER_MARKER)
    await expect(app.window().locator('[role="log"]')).toBeVisible()

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_A)
    await mainWindow.expectTextVisible('Please explain OpenWaggle in detail.')
    await expect(app.window().locator('[role="log"]')).toBeVisible()
    await mainWindow.expectLastUserMessageVisible()

    await expect
      .poll(async () => {
        return app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        })
      })
      .toBeGreaterThanOrEqual(customScrollTop - SCROLL_RESTORE_TOLERANCE_PX)

    await expect
      .poll(async () => {
        return app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        })
      })
      .toBeLessThanOrEqual(customScrollTop + SCROLL_RESTORE_TOLERANCE_PX)

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_B)
    await app.restart()

    const restartedWindow = app.mainWindow()
    await restartedWindow.openThread(NAV_SCROLL_THREAD_TITLE_A)
    await restartedWindow.expectTextVisible('Please explain OpenWaggle in detail.')
    await expect(app.window().locator('[role="log"]')).toBeVisible()
    await restartedWindow.expectLastUserMessageVisible()

    await expect
      .poll(async () => {
        return app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        })
      })
      .toBeGreaterThanOrEqual(customScrollTop - SCROLL_RESTORE_TOLERANCE_PX)

    await expect
      .poll(async () => {
        return app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        })
      })
      .toBeLessThanOrEqual(customScrollTop + SCROLL_RESTORE_TOLERANCE_PX)
  } finally {
    await app.cleanup()
  }
})
