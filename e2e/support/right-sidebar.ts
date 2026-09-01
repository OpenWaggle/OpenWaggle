import { expect, type Page } from '@playwright/test'

export async function expectRightSidebarClosed(page: Page) {
  const shell = page.locator('[data-right-sidebar-shell="true"]')
  await expect
    .poll(async () => {
      if ((await shell.count()) === 0) return true
      return shell.evaluate((element) =>
        element instanceof HTMLDialogElement
          ? !element.open
          : element.getBoundingClientRect().width === 0,
      )
    })
    .toBe(true)
}
