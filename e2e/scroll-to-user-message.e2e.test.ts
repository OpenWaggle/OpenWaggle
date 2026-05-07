import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeThreadNavigationScrollSessions,
  makeScrollRegressionSession,
  NAV_SCROLL_THREAD_TITLE_A,
  NAV_SCROLL_THREAD_TITLE_B,
  NAV_THREAD_B_USER_MARKER,
  SCROLL_THREAD_TITLE,
} from './support/scroll-regression-fixtures'

const SCROLL_RESTORE_TOLERANCE_PX = 16

test('after sending a message, transcript sticks to the bottom like t3code', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-regression-')

  try {
    await makeScrollRegressionSession(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(SCROLL_THREAD_TITLE)

    await mainWindow.expectUserMessageAttributeCount(1)

    await mainWindow.messageInput().fill('What about the renderer architecture?')
    await mainWindow.submitComposer()

    await mainWindow.expectLastUserMessageVisible()
    await mainWindow.expectChatScrollerAtBottom()
    await mainWindow.expectScrollToBottomButtonHidden()
  } finally {
    await app.cleanup()
  }
})

test('[data-user-message-id] attribute is present on user message rows', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-attr-')

  try {
    await makeScrollRegressionSession(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(SCROLL_THREAD_TITLE)

    await mainWindow.expectUserMessageAttributeCount(1)
    await mainWindow.expectLastUserMessageVisible()
  } finally {
    await app.cleanup()
  }
})

test('thread navigation restores per-thread scroll and does not jump to user-anchor including restart', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-scroll-navigation-')

  try {
    await makeThreadNavigationScrollSessions(app.userDataDir)
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
      throw new Error(`Expected a scrolled position after wheel input, got ${customScrollTop}`)
    }

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_B)
    await mainWindow.expectTextVisible(NAV_THREAD_B_USER_MARKER)
    await expect(app.window().locator('[role="log"]')).toBeVisible()

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_A)
    await mainWindow.expectTextVisible('Please explain OpenWaggle in detail.')
    await expect(app.window().locator('[role="log"]')).toBeVisible()
    await mainWindow.expectLastUserMessageVisible()

    await expect
      .poll(async () =>
        app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        }),
      )
      .toBeGreaterThanOrEqual(customScrollTop - SCROLL_RESTORE_TOLERANCE_PX)

    await expect
      .poll(async () =>
        app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        }),
      )
      .toBeLessThanOrEqual(customScrollTop + SCROLL_RESTORE_TOLERANCE_PX)

    await mainWindow.openThread(NAV_SCROLL_THREAD_TITLE_B)
    await app.restart()

    const restartedWindow = app.mainWindow()
    await restartedWindow.openThread(NAV_SCROLL_THREAD_TITLE_A)
    await restartedWindow.expectTextVisible('Please explain OpenWaggle in detail.')
    await expect(app.window().locator('[role="log"]')).toBeVisible()
    await restartedWindow.expectLastUserMessageVisible()

    await expect
      .poll(async () =>
        app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        }),
      )
      .toBeGreaterThanOrEqual(customScrollTop - SCROLL_RESTORE_TOLERANCE_PX)

    await expect
      .poll(async () =>
        app.window().evaluate(() => {
          const scroller = document.querySelector('[role="log"]')
          if (!(scroller instanceof HTMLElement)) {
            return null
          }
          return scroller.scrollTop
        }),
      )
      .toBeLessThanOrEqual(customScrollTop + SCROLL_RESTORE_TOLERANCE_PX)
  } finally {
    await app.cleanup()
  }
})
