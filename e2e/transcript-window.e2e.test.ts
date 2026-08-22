import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

/**
 * A long transcript is opened from its newest end, in the real app.
 *
 * Opening a session used to mount every row it had: 401 rows, 7,200 DOM nodes and 50,216px of
 * content in a 580px viewport, which blocked the renderer for over a second on every switch.
 * Component tests cover the window arithmetic; this proves the wiring from the database through
 * the projection into the transcript, and that the rest of the history is still reachable.
 *
 * Asserts on what is built rather than on milliseconds, so it fails for a real regression instead
 * of for a slow machine.
 */

const PROJECT_LABEL = 'transcript-window-repo'
const LONG_TITLE = 'Long session with a full history'
const SHORT_TITLE = 'Short session'
const LONG_MESSAGE_COUNT = 300
const SHORT_MESSAGE_COUNT = 4
const INITIAL_ROW_WINDOW = 40

function message(prefix: string, index: number, createdAt: number) {
  return {
    id: `${prefix}-m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    createdAt,
    parts: [{ type: 'text', text: `history line ${index}` }],
  }
}

/** Node ids are unique across the database, so each session needs its own message id prefix. */
function transcript(prefix: string, count: number) {
  const base = Date.now() - count * 60_000
  return Array.from({ length: count }, (_, index) => message(prefix, index, base + index * 60_000))
}

test('a long transcript opens at its newest end and can be walked back', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-transcript-window-e2e-')

  try {
    const projectPath = path.join(app.userDataDir, PROJECT_LABEL)
    await fs.mkdir(projectPath, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })

    await seedSessions(app.userDataDir, [
      {
        title: LONG_TITLE,
        projectPath,
        updatedAt: Date.now(),
        messages: transcript('long', LONG_MESSAGE_COUNT),
      },
      {
        title: SHORT_TITLE,
        projectPath,
        updatedAt: Date.now() - 60_000,
        messages: transcript('short', SHORT_MESSAGE_COUNT),
      },
    ])
    await app.restart()

    const { page } = app.mainWindow()
    const sidebarRow = (title: string) =>
      page.locator('[data-qa="sidebar-session-row"]').filter({ hasText: title })
    const loadEarlier = page.getByRole('button', { name: /Load earlier messages/ })

    await test.step('the newest message is shown and the oldest is not built', async () => {
      await sidebarRow(LONG_TITLE).click()
      await expect(page.getByText(`history line ${LONG_MESSAGE_COUNT - 1}`)).toBeVisible()
      await expect(page.getByText('history line 0')).toHaveCount(0)
      await expect(loadEarlier).toBeVisible()
    })

    await test.step('the control says how much history is above', async () => {
      await expect(loadEarlier).toHaveText(
        `Load earlier messages (${LONG_MESSAGE_COUNT - INITIAL_ROW_WINDOW} above)`,
      )
    })

    await test.step('the whole history is reachable a page at a time', async () => {
      // 300 rows behind a 40 row window and 100 row pages: three presses reach the start.
      const MAX_PAGES = 6
      for (let page_ = 0; page_ < MAX_PAGES; page_ += 1) {
        if ((await loadEarlier.count()) === 0) break
        await loadEarlier.click()
      }
      await expect(loadEarlier).toHaveCount(0)
      await expect(page.getByText('history line 0')).toBeVisible()
    })

    await test.step('a short session needs no control and shows everything', async () => {
      await sidebarRow(SHORT_TITLE).click()
      await expect(page.getByText(`history line ${SHORT_MESSAGE_COUNT - 1}`)).toBeVisible()
      await expect(page.getByText('history line 0')).toBeVisible()
      await expect(loadEarlier).toHaveCount(0)
    })

    await test.step('returning to the long session opens at its newest end again', async () => {
      await sidebarRow(LONG_TITLE).click()
      await expect(page.getByText(`history line ${LONG_MESSAGE_COUNT - 1}`)).toBeVisible()
      // The expanded window from the earlier visit must not persist.
      await expect(loadEarlier).toBeVisible()
    })
  } finally {
    await app.cleanup()
  }
})
