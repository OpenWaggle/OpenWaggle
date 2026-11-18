import type { Locator, Page } from '@playwright/test'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import { openDraft, prepareEssentials } from './website-screenshot-essentials-setup'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import { type CaptureContext, UI_TIMEOUT_MS, waitForUi } from './website-screenshot-ui'

/**
 * The composer of a new jotter session, one feature per image (ADR 0061): the plain composer,
 * then each of its menus open with the menu outlined.
 */

function toolbar(page: Page) {
  return page.getByTestId('composer-toolbar')
}

/** The composer's dock: the editor, its toolbar and anything stacked above them. */
function dock(page: Page) {
  return regionOf(page.getByRole('region', { name: 'Composer file drop zone' }))
}

/** The draft's composer with its project, environment and branch row above it. */
async function composerRegion(page: Page) {
  const environment = await regionOf(
    page.getByRole('button', { name: /^Session environment mode/ }),
  )
  return unionRegion([environment, await regionOf(toolbar(page)), await dock(page)], CROP_MARGIN_PX)
}

/** The composer of a new session, as it first appears, with nothing typed. */
export async function captureComposerNewSession(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  await shootRegion(context, 'composer-new-session.png', await composerRegion(page))
}

/**
 * Opens a composer menu from its trigger and shoots it over the composer, outlined. The menu is
 * closed again with Escape so the next capture starts from the plain draft.
 */
async function shootComposerMenu(
  context: CaptureContext,
  file: WebsiteScreenshot,
  trigger: Locator,
  firstItem: string | RegExp,
) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  await trigger.click()
  const menu = page.getByRole('menu').filter({ hasText: firstItem }).last()
  await menu.waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  const menuBox = await regionOf(menu)
  // Focus leaves the trigger, so the composer drops its focus ring; the menu stays open.
  await shootRegion(context, file, unionRegion([menuBox, await dock(page)], CROP_MARGIN_PX), {
    outline: menuBox,
  })
  if (!(await menu.isVisible())) throw new Error(`The menu for ${file} closed before the shot.`)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
}

/** The + menu: attach files, reference a project file, use a skill, start Waggle. */
export async function captureComposerPlusMenu(context: CaptureContext) {
  await shootComposerMenu(
    context,
    'composer-plus-menu.png',
    toolbar(context.page).getByRole('button', { name: 'Add to message' }),
    'Attach files',
  )
}

/** The thinking level menu of the fixture model. */
export async function captureComposerThinkingMenu(context: CaptureContext) {
  await shootComposerMenu(
    context,
    'composer-thinking-menu.png',
    toolbar(context.page).getByRole('button', { name: /^Thinking level/ }),
    /Medium/,
  )
}

/** The agent access menu: Ask for approval, and the other access modes. */
export async function captureComposerAgentAccessMenu(context: CaptureContext) {
  await shootComposerMenu(
    context,
    'composer-agent-access-menu.png',
    toolbar(context.page).getByRole('button', { name: /^Session access mode/ }),
    'Agent access',
  )
}
