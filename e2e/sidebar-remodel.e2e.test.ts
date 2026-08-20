import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

/**
 * The remodelled sidebar, verified in the real app.
 *
 * Restricted to claims component tests cannot make: the sidebar's width in Electron, the row
 * geometry the approved prototype specifies, and whether view state genuinely survives a
 * process restart. Persistence in particular was the reason this work exists, and a jsdom
 * store test cannot prove that a relaunched Electron app reads its own localStorage back.
 */

const PROJECT_LABEL = 'sidebar-remodel-repo'
const OTHER_PROJECT_LABEL = 'sidebar-remodel-other'
const FIRST_TITLE = 'Remodel first session with a long title'
const SECOND_TITLE = 'Remodel second session'
const OTHER_TITLE = 'Other project session'

const SIDEBAR_WIDTH = 316
const ROW_HEIGHT = 48

function message(text: string, createdAt: number) {
  return { id: `${text}-id`, role: 'user', createdAt, parts: [{ type: 'text', text }] }
}

test('sidebar remodel: width, two-line rows, and view state that survives a restart', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-sidebar-remodel-e2e-')

  try {
    const projectPath = path.join(app.userDataDir, PROJECT_LABEL)
    const otherProjectPath = path.join(app.userDataDir, OTHER_PROJECT_LABEL)
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(otherProjectPath, { recursive: true })

    await seedSessions(app.userDataDir, [
      {
        title: FIRST_TITLE,
        projectPath,
        updatedAt: Date.now() - 1000,
        messages: [message('first-body', Date.now() - 1000)],
      },
      {
        title: SECOND_TITLE,
        projectPath,
        updatedAt: Date.now() - 2000,
        messages: [message('second-body', Date.now() - 2000)],
      },
      {
        title: OTHER_TITLE,
        projectPath: otherProjectPath,
        updatedAt: Date.now() - 3000,
        messages: [message('other-body', Date.now() - 3000)],
      },
    ])
    await app.restart()

    const { page } = app.mainWindow()

    // ── The sidebar is the width the approved design was drawn at ──────────────
    const sidebar = page.locator('nav[aria-label="Sidebar"]')
    await expect(sidebar).toBeVisible()
    expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(SIDEBAR_WIDTH)

    // ── Rows are two lines and every row is the same height ───────────────────
    const rows = page.locator('[data-qa="sidebar-session-row"]')
    await expect(rows.first()).toBeVisible()

    const heights = await rows.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    )
    expect(new Set(heights)).toEqual(new Set([ROW_HEIGHT]))

    // Addressed by title, not by position: project order is the sidebar's business, and a
    // test that assumes it fails for the wrong reason when the ordering rule changes.
    const firstRow = rows.filter({ hasText: FIRST_TITLE })
    await expect(firstRow.locator('[data-qa="sidebar-row-title-line"]')).toBeVisible()
    await expect(firstRow.locator('[data-qa="sidebar-row-line2"]')).toBeVisible()

    // The full title is present, not shortened into the markup.
    await expect(firstRow.locator('[data-qa="sidebar-row-title"]')).toHaveText(FIRST_TITLE)

    // ── The timestamp does not hide, and does not move, on hover ──────────────
    const when = firstRow.locator('[data-qa="sidebar-row-when"]')
    await expect(when).toBeVisible()
    const restingBox = await when.boundingBox()

    await firstRow.hover()
    await expect(page.getByRole('button', { name: `Pin session ${FIRST_TITLE}` })).toBeVisible()
    await expect(when).toBeVisible()
    const hoveredBox = await when.boundingBox()
    expect(Math.round(hoveredBox?.x ?? 0)).toBe(Math.round(restingBox?.x ?? -1))

    // ── The sidebar never scrolls sideways ────────────────────────────────────
    const scroller = page.locator('[data-qa="sidebar-scroll"]')
    const overflow = await scroller.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    // ── The whole row opens the session, not just the title text ─────────────
    /*
     * Regression guard. The two-line remodel left the click handler sized to the title, so 70% of
     * a 316x48 row was dead to clicks: measured by sampling elementFromPoint across the row in
     * the running app. Clicking anywhere did nothing, which reads as broken navigation rather
     * than as a small target.
     *
     * This has to be an end-to-end test. The fix stretches the control with a pseudo-element, so
     * only a real hit test can tell whether a point in the row reaches it, and jsdom has none.
     */
    const secondRow = page.locator('[data-qa="sidebar-session-row"]').filter({
      hasText: SECOND_TITLE,
    })
    const box = await secondRow.boundingBox()
    if (box === null) throw new Error('no row box')

    // The timestamp on line two, at the far end of the row from the title.
    await secondRow.click({ position: { x: box.width - 14, y: box.height - 8 } })
    await expect(secondRow).toHaveAttribute('aria-current', 'true')

    // The glyph column on line one, left of the title.
    const glyphSideRow = page
      .locator('[data-qa="sidebar-session-row"]')
      .filter({ hasText: FIRST_TITLE })
    const glyphBox = await glyphSideRow.boundingBox()
    if (glyphBox === null) throw new Error('no row box')
    await glyphSideRow.click({ position: { x: 6, y: glyphBox.height - 6 } })
    await expect(glyphSideRow).toHaveAttribute('aria-current', 'true')

    // ── Collapse a project, then relaunch and expect it still collapsed ───────
    /*
     * Scoped to the sidebar rows. A session is open by now, so its title also appears in the
     * chat, and an unscoped text match would resolve to two elements.
     */
    const sidebarRowByTitle = (page: Page, title: string) =>
      page.locator('[data-qa="sidebar-session-row"]').filter({ hasText: title })

    await expect(sidebarRowByTitle(page, FIRST_TITLE)).toBeVisible()
    await page.getByRole('button', { name: `Collapse ${PROJECT_LABEL}` }).click()
    await expect(sidebarRowByTitle(page, FIRST_TITLE)).toBeHidden()

    // Change the sort too, so both persisted preferences are covered by one restart.
    await page.locator('[data-qa="sidebar-section-head"]').last().hover()
    await page.getByRole('button', { name: 'Sort sessions' }).click()
    await page.getByRole('menuitemradio', { name: /name/i }).click()

    await app.restart()
    const restarted = app.mainWindow().page

    await expect(restarted.getByRole('button', { name: `Expand ${PROJECT_LABEL}` })).toBeVisible()
    await expect(sidebarRowByTitle(restarted, FIRST_TITLE)).toBeHidden()
    // The other project was never collapsed, so it must come back expanded.
    await expect(sidebarRowByTitle(restarted, OTHER_TITLE)).toBeVisible()

    await restarted.locator('[data-qa="sidebar-section-head"]').last().hover()
    await restarted.getByRole('button', { name: 'Sort sessions' }).click()
    await expect(restarted.getByRole('menuitemradio', { name: /name/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  } finally {
    await app.cleanup()
  }
})
