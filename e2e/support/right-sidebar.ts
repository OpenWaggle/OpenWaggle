import { expect, type Page } from '@playwright/test'

export async function expectRightSidebarClosed(page: Page) {
  const shells = page.locator('[data-right-sidebar-shell="true"]')
  await expect
    .poll(() =>
      shells.evaluateAll((elements) =>
        // Route and workspace sidebars can both remain mounted while closed.
        elements.every((element) =>
          element instanceof HTMLDialogElement
            ? !element.open
            : element.getBoundingClientRect().width === 0,
        ),
      ),
    )
    .toBe(true)
}
