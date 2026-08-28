import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

const SOURCE_PROJECT_LABEL = 'draft-source-repo'
const TARGET_PROJECT_LABEL = 'draft-target-repo'
const SOURCE_THREAD_TITLE = 'Source Existing Conversation'
const TARGET_THREAD_TITLE = 'Target Existing Conversation'
const SOURCE_THREAD_BODY = 'source-transcript-body-before-draft'
const TARGET_THREAD_BODY = 'target-transcript-body-before-draft'

async function expectHitTestVisible(locator: Locator) {
  await expect(locator).toBeVisible()
  const receivesPointerAtCenter = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && (hit === element || element.contains(hit))
  })
  expect(receivesPointerAtCenter).toBe(true)
}

async function expectPopoverAboveDock(popover: Locator, dock: Locator) {
  const [popoverBox, dockBox] = await Promise.all([popover.boundingBox(), dock.boundingBox()])
  expect(popoverBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  if (!popoverBox || !dockBox) return
  expect(popoverBox.y + popoverBox.height).toBeLessThan(dockBox.y)
}

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

    await app.resizeMainWindow(720, 700)
    const dock = mainWindow.page.getByTestId('session-setup-dock-row')
    await expect(dock).toBeVisible()

    const projectTrigger = mainWindow.page.getByRole('button', {
      name: `Project: ${TARGET_PROJECT_LABEL}`,
    })
    const environmentTrigger = mainWindow.page.getByRole('button', {
      name: 'Session environment mode: Current checkout',
    })
    const branchTrigger = mainWindow.page.getByRole('button', { name: /Run target:/ })
    await expectHitTestVisible(projectTrigger)
    await expectHitTestVisible(environmentTrigger)
    await expectHitTestVisible(branchTrigger)

    await projectTrigger.click()
    const projectPopover = mainWindow.page.getByRole('dialog', { name: 'Choose a project' })
    await expectHitTestVisible(mainWindow.page.getByRole('searchbox', { name: 'Search projects' }))
    await expectPopoverAboveDock(projectPopover, dock)
    await expect(mainWindow.page.getByRole('button', { name: 'Select folder…' })).toBeVisible()
    await mainWindow.page.keyboard.press('Escape')

    await environmentTrigger.click()
    const environmentMenu = mainWindow.page.getByRole('menu')
    await expectHitTestVisible(environmentMenu)
    await expectPopoverAboveDock(environmentMenu, dock)
    await expect(environmentMenu.getByRole('menuitemradio')).toHaveCount(2)
    await mainWindow.page.keyboard.press('Escape')

    await branchTrigger.click()
    const branchSearch = mainWindow.page.getByPlaceholder('Search branches')
    await expectHitTestVisible(branchSearch)
    await expectPopoverAboveDock(
      mainWindow.page.getByRole('dialog', { name: 'Choose a run target' }),
      dock,
    )
    await mainWindow.page.keyboard.press('Escape')

    await expect(
      mainWindow.page.getByRole('region', { name: 'Composer file drop zone' }),
    ).toHaveCSS('border-radius', '12px')
    await expect(projectTrigger.locator('xpath=ancestor::*[contains(@class, "rounded-t-xl")][1]')).toHaveCSS(
      'border-top-left-radius',
      '12px',
    )
  } finally {
    await app.cleanup()
  }
})
