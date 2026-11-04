import type { Page } from '@playwright/test'
import {
  type Callout,
  CROP_MARGIN_PX,
  type Region,
  regionOf,
  shootRegion,
  spanRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import {
  INTERRUPTED_SESSION_TITLE,
  TOOL_ROWS_SESSION_TITLE,
} from './website-screenshot-essentials-fixture'
import {
  APPROVAL_TITLE,
  WORKING_FOLLOW_UPS,
  WORKING_TITLE,
  WORKTREE_PROMPT,
} from './website-screenshot-essentials-scenarios'
import {
  ensureLiveSessions,
  openDraft,
  prepareEssentials,
  SIDEBAR_PAD_PX,
  sendMessage,
  sidebar,
  TIGHT_PAD_PX,
} from './website-screenshot-essentials-setup'
import {
  type CaptureContext,
  GIT_READY_TIMEOUT_MS,
  openSession,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

/** Room above a control row for the callout badges. */
const CALLOUT_HEADROOM_PX = 34

function composer(page: Page) {
  return page.getByTestId('composer-toolbar')
}

/** The composer of a draft, with its context row above and room for badges. */
async function composerRegion(page: Page): Promise<Region> {
  const environment = await regionOf(
    page.getByRole('button', { name: /^Session environment mode/ }),
  )
  const toolbar = await regionOf(composer(page))
  const dock = await regionOf(
    composer(page).locator('xpath=ancestor::*[contains(@class, "rounded")][1]'),
  )
  const box = unionRegion([environment, toolbar, dock], CROP_MARGIN_PX)
  return { ...box, y: box.y - CALLOUT_HEADROOM_PX, height: box.height + CALLOUT_HEADROOM_PX }
}

/**
 * The composer of a new session, numbered: where it runs (environment and branch), attach,
 * access mode, model, thinking level, context, and voice.
 */
export async function captureComposerControls(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  const toolbar = composer(page)
  // Numbered left to right, top row first; the docs explain each number.
  const controls = [
    page.getByRole('button', { name: /^Session environment mode/ }),
    page.getByRole('button', { name: /^Run target/ }),
    toolbar.getByRole('button', { name: 'Add to message' }),
    toolbar.getByRole('button', { name: /^Session access mode/ }),
    toolbar.getByRole('button', { name: /GPT-5\.4/ }),
    toolbar.getByRole('button', { name: /^Thinking level/ }),
    // The ring and its "0 / 272k" label.
    toolbar
      .getByRole('img', { name: 'Context usage meter' })
      .locator('xpath=ancestor::div[@title][1]'),
    toolbar.getByRole('button', { name: 'Start voice input' }),
  ]
  const callouts: Callout[] = []
  for (const [index, control] of controls.entries()) {
    callouts.push({ number: index + 1, region: await regionOf(control) })
  }
  await shootRegion(context, 'composer-controls.png', await composerRegion(page), { callouts })
}

function editorBox(page: Page) {
  return page.getByRole('textbox', { name: 'Message input' })
}

/** The composer's dock: the editor, its toolbar and anything stacked above them. */
async function composerDockRegion(page: Page) {
  return regionOf(page.getByRole('region', { name: 'Composer file drop zone' }))
}

/** The `/` menu over a new-session draft: commands, the project's skills and Waggle presets. */
export async function captureSlashCommandMenu(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  await editorBox(page).click()
  await page.keyboard.type('/')
  const menu = page.getByRole('menu', { name: 'Slash command menu' })
  await menu.getByRole('menuitem', { name: /^release-notes/ }).waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  const region = unionRegion([await regionOf(menu), await composerDockRegion(page)], CROP_MARGIN_PX)
  await shootRegion(context, 'slash-command-menu.png', region, { keepFocus: true })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
}

/** The global command palette, opened with its shortcut over a draft. */
export async function captureCommandPalette(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('menuitem', { name: /^Go to file/ }).waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  // The dialog role covers the whole window; the panel is its innermost box with the title and
  // the search field.
  const panel = palette
    .locator('xpath=.//*[.//h2[normalize-space()="Command palette"] and .//input]')
    .last()
  await shootRegion(
    context,
    'command-palette.png',
    unionRegion([await regionOf(panel)], CROP_MARGIN_PX),
    {
      keepFocus: true,
    },
  )
  await page.keyboard.press('Escape')
}

/** An approval request in the transcript and above the composer, with its scope choices open. */
export async function captureApprovalRequest(context: CaptureContext) {
  const { page } = context
  await ensureLiveSessions(context)
  await openSession(page, APPROVAL_TITLE)
  const ribbon = page.locator('[data-authorization-ribbon="true"]')
  await ribbon
    .getByRole('button', { name: 'Allow once', exact: true })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await ribbon.getByRole('button', { name: 'Allow…', exact: true }).click()
  const scopes = ribbon.getByRole('group', { name: 'Approval scope' })
  await scopes.waitFor({ timeout: UI_TIMEOUT_MS })
  // The request above the composer, with its scope menu open over the conversation.
  const region = unionRegion(
    [await regionOf(ribbon), await composerDockRegion(page), await regionOf(scopes)],
    CROP_MARGIN_PX,
  )
  await shootRegion(context, 'approval-request.png', region, { keepFocus: true })
  await page.keyboard.press('Escape')
}

/** A busy Session with two follow-ups queued above the composer. */
export async function captureQueuedFollowUps(context: CaptureContext) {
  const { page } = context
  await ensureLiveSessions(context)
  await openSession(page, WORKING_TITLE)
  const last = WORKING_FOLLOW_UPS[WORKING_FOLLOW_UPS.length - 1] ?? ''
  await page.getByText(last, { exact: true }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  // The queue's header and list sit above the composer, outside its drop zone.
  const queue = page.getByRole('list', { name: 'Queued messages' }).locator('xpath=..')
  await shootRegion(
    context,
    'queued-follow-ups.png',
    unionRegion([await regionOf(queue), await composerDockRegion(page)], CROP_MARGIN_PX),
  )
}

/**
 * The essentials project in the sidebar: Working, Input, Error, Done and Interrupted rows, the
 * state chips above them, and the provenance icons (branch, worktree, conversation branches,
 * commits ahead and behind).
 */
export async function captureSidebarStates(context: CaptureContext) {
  const { page } = context
  await ensureLiveSessions(context)
  await openSession(page, WORKING_TITLE)
  const nav = sidebar(page)
  const chips = nav.getByRole('group', { name: 'Filter sessions by state' })
  const interrupted = nav.getByRole('listitem').filter({ hasText: INTERRUPTED_SESSION_TITLE })
  await interrupted.getByText('↑2 ↓1').waitFor({ timeout: UI_TIMEOUT_MS })
  // The seeded Hive finished while nobody had it open, so it reads Done.
  await nav
    .getByRole('listitem')
    .filter({ hasText: TOOL_ROWS_SESSION_TITLE })
    .getByText('Done', { exact: true })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  const navBox = await regionOf(nav)
  const span = spanRegion({
    top: await regionOf(chips),
    bottom: await regionOf(interrupted),
    across: navBox,
    pad: SIDEBAR_PAD_PX,
  })
  // The sidebar's own edges frame the crop; only the top and bottom are padded. Its overlay
  // scrollbar shows for a moment after the list scrolls, so it is hidden.
  await shootRegion(
    context,
    'sidebar-states.png',
    { ...span, x: navBox.x, width: navBox.width },
    { hideScrollbars: true },
  )
}

/**
 * A finished turn's tool rows: a shell command, a failed read, an edit opened to its diff, an MCP
 * tool, and a Worker spawn with its state and Open.
 */
export async function captureToolRows(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSession(page, TOOL_ROWS_SESSION_TITLE)
  const log = page.getByRole('log', { name: 'Chat messages' })
  const details = log.getByRole('button', { name: 'Expand turn details' })
  if ((await details.count()) > 0) await details.click()
  const edit = log.getByRole('button', { name: /^Edited src\/upload\/retry\.ts/ })
  if ((await edit.getAttribute('aria-expanded')) !== 'true') await edit.click()
  await log.getByRole('region', { name: 'Diff of retry.ts' }).waitFor({ timeout: UI_TIMEOUT_MS })
  const first = log.getByText('I’ll run the upload tests first', { exact: false })
  const spawn = log.getByRole('button', { name: /^Open Worker Session/ })
  await spawn.waitFor({ timeout: UI_TIMEOUT_MS })
  await first.scrollIntoViewIfNeeded()
  // Expanding the edit scrolls the transcript; the crop is measured once it has stopped moving.
  await shootRegion(context, 'tool-rows.png', async () => {
    const logBox = await regionOf(log)
    const textBox = await regionOf(first)
    const spawnBox = await regionOf(spawn)
    const left = textBox.x - CROP_MARGIN_PX
    const top = textBox.y - CROP_MARGIN_PX
    return {
      x: left,
      y: top,
      width: Math.min(logBox.x + logBox.width, spawnBox.x + spawnBox.width + CROP_MARGIN_PX) - left,
      // The reply starts just below the spawn row; a small margin keeps it out of the crop.
      height: spawnBox.y + spawnBox.height + TIGHT_PAD_PX - top,
    }
  })
}

/**
 * A first message sent from New worktree: the expanded Worktree created row lists each step,
 * above the reply. The in-flight card it replaces lasts only as long as Git takes, so the
 * finished row is the deterministic one.
 */
export async function captureWorktreeFirstSend(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openDraft(page)
  await page.getByRole('button', { name: /^Session environment mode/ }).click()
  await page.getByRole('menuitemradio', { name: /^New worktree/ }).click()
  await sendMessage(page, WORKTREE_PROMPT)
  const created = page.getByRole('button', { name: 'Worktree created' })
  await created.waitFor({ timeout: GIT_READY_TIMEOUT_MS })
  const log = page.getByRole('log', { name: 'Chat messages' })
  const reply = log.getByText('Uploads no longer retry client errors.')
  await reply.waitFor({ timeout: UI_TIMEOUT_MS })
  // Expanded only once the reply has finished: the row renders again when the turn settles and
  // starts out closed.
  await waitForUi(page)
  if ((await created.getAttribute('aria-expanded')) !== 'true') await created.click()
  await log.getByText('Starting the task in the new worktree').waitFor({ timeout: UI_TIMEOUT_MS })
  const prompt = log.getByText(WORKTREE_PROMPT, { exact: true })
  await shootRegion(context, 'worktree-first-send.png', async () =>
    unionRegion(
      [await regionOf(prompt), await regionOf(created), await regionOf(reply)],
      CROP_MARGIN_PX,
    ),
  )
  if ((await created.getAttribute('aria-expanded')) !== 'true') {
    throw new Error('Worktree created closed again before the screenshot.')
  }
}
