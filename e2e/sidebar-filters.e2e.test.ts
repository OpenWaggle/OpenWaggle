import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

/**
 * The sidebar's narrowing controls, in the real app.
 *
 * Component tests cover the chips with seeded store state, but they cannot prove the wiring from
 * the database through the projection into the row that renders. An interrupted run is the one
 * non-idle state that can be seeded from disk, so it is what makes a real chip appear here.
 *
 * Split into steps so a failure names the claim that broke rather than hiding the rest.
 */

const ALPHA = 'chips-alpha'
const BETA = 'chips-beta'
const CALM_TITLE = 'Calm session in alpha'
const STUCK_TITLE = 'Stuck session in alpha'
const OTHER_STUCK_TITLE = 'Stuck session in beta'

function message(text: string) {
  return { id: `${text}-id`, role: 'user', createdAt: Date.now(), parts: [{ type: 'text', text }] }
}

test('sidebar filtering: chips, pips, search and Escape', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-sidebar-filters-e2e-')

  try {
    const alphaPath = path.join(app.userDataDir, ALPHA)
    const betaPath = path.join(app.userDataDir, BETA)
    await fs.mkdir(alphaPath, { recursive: true })
    await fs.mkdir(betaPath, { recursive: true })

    await seedSessions(app.userDataDir, [
      { title: CALM_TITLE, projectPath: alphaPath, updatedAt: Date.now() - 1000, messages: [message('calm')] },
      {
        title: STUCK_TITLE,
        projectPath: alphaPath,
        updatedAt: Date.now() - 2000,
        messages: [message('stuck')],
        interruptedRun: true,
      },
      {
        title: OTHER_STUCK_TITLE,
        projectPath: betaPath,
        updatedAt: Date.now() - 3000,
        messages: [message('other')],
        interruptedRun: true,
      },
    ])
    await app.restart()

    const { page } = app.mainWindow()
    const chipGroup = page.getByRole('group', { name: 'Filter sessions by state' })
    const rows = page.locator('[data-qa="sidebar-session-row"]')
    const searchInput = page.locator('[data-qa="sidebar-search"] input')
    const interruptedChip = chipGroup.getByRole('button', {
      name: /Run interrupted, resumable, 2/,
    })
    const fillSearch = (value: string) =>
      expect(async () => {
        await searchInput.fill(value)
        await expect(searchInput).toHaveValue(value)
      }).toPass({ timeout: 5000 })

    await test.step('a chip appears for the state that is present, with its count', async () => {
      await expect(chipGroup).toBeVisible()
      await expect(interruptedChip).toBeVisible()
      // Idle never earns a chip, so the calm session contributes nothing.
      await expect(chipGroup.getByRole('button')).toHaveCount(1)
    })

    await test.step('the row reports the same state in words', async () => {
      const stuckRow = rows.filter({ hasText: STUCK_TITLE })
      await expect(stuckRow.locator('[data-qa="sidebar-row-state"]')).toHaveText('Interrupted')
    })

    await test.step('a project heading reports what is inside it', async () => {
      const pips = page.locator('[data-qa="sidebar-pip"]')
      await expect(pips.first()).toBeVisible()
      // One per project, each carrying a count rather than colour alone.
      await expect(pips).toHaveCount(2)
      await expect(pips.first()).toHaveText('1')
    })

    await test.step('clicking the chip isolates that state across every project', async () => {
      await interruptedChip.click()

      await expect(rows.filter({ hasText: STUCK_TITLE })).toHaveCount(1)
      await expect(rows.filter({ hasText: OTHER_STUCK_TITLE })).toHaveCount(1)
      await expect(rows.filter({ hasText: CALM_TITLE })).toHaveCount(0)
    })

    await test.step('the chip reports itself as pressed and stays available', async () => {
      await expect(
        chipGroup.getByRole('button', { name: /Clear filter: Run interrupted/ }),
      ).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('clicking it again restores every row', async () => {
      await chipGroup.getByRole('button', { name: /Clear filter: Run interrupted/ }).click()

      await expect(rows.filter({ hasText: CALM_TITLE })).toHaveCount(1)
      await expect(rows).toHaveCount(3)
    })

    await test.step('Cmd+F focuses the filter field', async () => {
      await page.keyboard.press('ControlOrMeta+f')

      await expect(searchInput).toBeFocused()
    })

    await test.step('text narrows by title', async () => {
      // `fill` models the final input event without asking an overloaded Electron renderer to
      // commit a controlled value between synthetic keystrokes sent much faster than a person.
      await fillSearch('Calm')
      await expect(rows.filter({ hasText: CALM_TITLE })).toHaveCount(1)
      await expect(rows.filter({ hasText: STUCK_TITLE })).toHaveCount(0)
    })

    await test.step('typing a project name keeps that project sessions', async () => {
      await fillSearch(BETA)

      await expect(rows.filter({ hasText: OTHER_STUCK_TITLE })).toHaveCount(1)
      await expect(rows.filter({ hasText: CALM_TITLE })).toHaveCount(0)
    })

    await test.step('Escape clears the filter and returns every row', async () => {
      await page.keyboard.press('Escape')

      await expect(searchInput).toHaveValue('')
      await expect(rows).toHaveCount(3)
    })

    await test.step('Escape clears both text and state filters together', async () => {
      await interruptedChip.click()
      await fillSearch('Calm')
      await expect(rows).toHaveCount(0)

      await searchInput.press('Escape')

      await expect(searchInput).toHaveValue('')
      await expect(interruptedChip).toHaveAttribute('aria-pressed', 'false')
      await expect(rows).toHaveCount(3)
    })

    await test.step('focus reaches the field and draws nothing', async () => {
      await page.keyboard.press('ControlOrMeta+f')
      // The shortcut focuses on the next frame, so measuring immediately can catch the wrong state.
      await expect(searchInput).toBeFocused()

      const marks = await page.evaluate(() => {
        const field = document.querySelector('[data-qa="sidebar-search"]')
        const input = field?.querySelector('input')
        if (!field || !input) return null
        return {
          fieldShadow: getComputedStyle(field).boxShadow,
          inputShadow: getComputedStyle(input).boxShadow,
          // Style, not width: `outline-style: none` leaves the computed width in place, so width
          // alone says nothing about whether an outline paints.
          inputOutlineStyle: getComputedStyle(input).outlineStyle,
        }
      })

      /*
       * Focus draws no ring, glow or outline anywhere. The app-wide decision is that focus is
       * invisible, so the only thing to assert is that the keyboard still reaches the field.
       */
      expect(marks?.fieldShadow).toBe('none')
      expect(marks?.inputShadow).toBe('none')
      expect(marks?.inputOutlineStyle).toBe('none')
    })

  } finally {
    await app.cleanup()
  }
})
