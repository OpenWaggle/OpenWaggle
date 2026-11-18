import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import {
  CROP_MARGIN_PX,
  centerOf,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import { THREAD_TITLE } from './website-screenshot-fixture'
import { type CaptureContext, openSession, UI_TIMEOUT_MS, waitForUi } from './website-screenshot-ui'

const SHELL_OUTPUT_TIMEOUT_MS = 60_000
const TERMINAL_PANEL_HEIGHT_PX = 420
const RAIL_DRAG_STEPS = 10
const TAB_NAME = 'release checks'
const SPLIT_PANE_COUNT = 2
/** `node --test` prints its command's row, then one row per passing test. */
const FIRST_PASSING_TEST_ROW = 1
const LAST_PASSING_TEST_ROW = 2
const MENU_POINTER_ACROSS_ROW = 0.75
const MENU_POINTER_ROW_INSET_PX = 3
/** The menu crop ends below this row of the test pane, past the menu's last item. */
const MENU_CROP_LAST_ROW = 9
const MENU_CROP_MARGIN_PX = 8

/**
 * A fixed prompt, so the panes show the folder name and no user, host or path. The terminal's
 * shell integration still sources the user's startup file from the scratch HOME.
 */
const SHELL_STARTUP_FILES = {
  '.zshrc': "PROMPT='%F{cyan}%1~%f %# '\nunsetopt PROMPT_SP\n",
  '.bashrc': "PS1='\\[\\e[36m\\]\\W\\[\\e[0m\\] \\$ '\n",
} as const

/** A real test the right-hand pane runs with `node --test`, as an agent might have added. */
const RELEASE_NOTES_TEST = `import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const notes = await readFile(new URL('../README.md', import.meta.url), 'utf8')

test('release notes start with the project heading', () => {
  assert.match(notes, /^# OpenWaggle/)
})

test('release notes mention the pending review', () => {
  assert.ok(notes.includes('pending release review'))
})
`

const CHAT_QUESTION = 'Both release-notes tests pass. Is anything else missing before we merge?'

async function writeShellFixture(context: CaptureContext) {
  for (const [file, contents] of Object.entries(SHELL_STARTUP_FILES)) {
    await fs.writeFile(path.join(context.homeDir, file), contents, 'utf8')
  }
  const settings = await context.page.evaluate(() => window.api.getSettings())
  const projectPath = settings.projectPath
  if (projectPath === null) throw new Error('The screenshot project is not open.')
  await fs.mkdir(path.join(projectPath, 'tests'), { recursive: true })
  await fs.writeFile(
    path.join(projectPath, 'tests', 'release-notes.test.mjs'),
    RELEASE_NOTES_TEST,
    'utf8',
  )
}

/** Removes the fixture tests, so later captures show only the README edit in Git status. */
async function removeTestFixture(context: CaptureContext) {
  const settings = await context.page.evaluate(() => window.api.getSettings())
  if (settings.projectPath === null) return
  await fs.rm(path.join(settings.projectPath, 'tests'), { recursive: true, force: true })
}

function terminalPanes(page: Page) {
  return page.locator('.xterm')
}

async function paneText(page: Page, index: number) {
  return terminalPanes(page).nth(index).locator('.xterm-rows').innerText()
}

/** Waits until a pane shows `text` and a fresh prompt after it. */
async function waitForPaneOutput(page: Page, index: number, text: string) {
  await expect
    .poll(
      async () => {
        const output = (await paneText(page, index)).trimEnd()
        return output.includes(text) && /%$|\$$/.test(output)
      },
      { timeout: SHELL_OUTPUT_TIMEOUT_MS },
    )
    .toBe(true)
}

async function waitForPrompt(page: Page, index: number) {
  await expect
    .poll(async () => /%$|\$$/.test((await paneText(page, index)).trimEnd()), {
      timeout: SHELL_OUTPUT_TIMEOUT_MS,
    })
    .toBe(true)
}

async function runInPane(page: Page, index: number, command: string, doneText: string) {
  await waitForPrompt(page, index)
  await terminalPanes(page).nth(index).click()
  await page.keyboard.type(`${command}\n`)
  await waitForPaneOutput(page, index, doneText)
}

async function setPanelHeight(page: Page, height: number) {
  const rail = page.locator('[data-terminal-resize-rail]')
  await rail.waitFor({ timeout: UI_TIMEOUT_MS })
  const current = Number(await rail.getAttribute('aria-valuenow'))
  const box = await regionOf(rail)
  const { x, y } = centerOf(box)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - (height - current), { steps: RAIL_DRAG_STEPS })
  await page.mouse.up()
  await waitForUi(page)
}

async function renameActiveTab(page: Page, name: string) {
  const tabs = page.getByRole('tablist', { name: 'Terminal tabs' })
  await tabs.getByRole('tab', { selected: true }).dblclick()
  const input = page.getByRole('textbox', { name: 'Terminal name' })
  await input.fill(name)
  await input.press('Enter')
  await tabs.getByRole('tab', { name: new RegExp(`^${name}`) }).waitFor({ timeout: UI_TIMEOUT_MS })
}

/**
 * The review Session's terminal: a second tab, then a renamed first tab split side by side, with
 * `git status` on the left and the project's tests on the right. Reused when it already exists.
 */
async function prepareTerminal(context: CaptureContext) {
  const { page } = context
  await openSession(page, THREAD_TITLE)
  await writeShellFixture(context)
  const open = page.locator('header').getByRole('button', { name: /^(Open|Show) terminal$/ })
  if ((await open.count()) > 0) await open.click()
  await terminalPanes(page).first().waitFor({ timeout: UI_TIMEOUT_MS })
  const tabs = page.getByRole('tablist', { name: 'Terminal tabs' })
  if ((await tabs.getByRole('tab', { name: new RegExp(`^${TAB_NAME}`) }).count()) > 0) return
  await setPanelHeight(page, TERMINAL_PANEL_HEIGHT_PX)
  await waitForPrompt(page, 0)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await tabs.getByRole('tab', { name: /^Terminal 2/ }).waitFor({ timeout: UI_TIMEOUT_MS })
  await tabs.getByRole('tab', { name: /^Terminal 1/ }).click()
  await renameActiveTab(page, TAB_NAME)
  await runInPane(page, 0, 'git status', 'no changes added to commit')
  await page.getByRole('button', { name: 'Split terminal side by side' }).click()
  await expect(terminalPanes(page)).toHaveCount(SPLIT_PANE_COUNT, { timeout: UI_TIMEOUT_MS })
  await runInPane(page, 1, 'node --test', 'duration_ms')
}

async function terminalPanel(page: Page) {
  const panel = page.getByTestId('workspace-terminal')
  await panel.waitFor({ timeout: UI_TIMEOUT_MS })
  return panel
}

/** The terminal drawer with two tabs, the open one split side by side. */
export async function captureTerminalSplitPanes(context: CaptureContext) {
  const { page } = context
  await prepareTerminal(context)
  await shootRegion(context, 'terminal-split-panes.png', await regionOf(await terminalPanel(page)))
}

function testPaneRows(page: Page) {
  return terminalPanes(page).nth(1).locator('.xterm-rows > div')
}

/** Selects the two passing-test lines in the right-hand pane and opens the pane's context menu. */
async function openSelectionMenu(page: Page) {
  const rows = testPaneRows(page)
  const first = await regionOf(rows.nth(FIRST_PASSING_TEST_ROW))
  const last = await regionOf(rows.nth(LAST_PASSING_TEST_ROW))
  const lastCenter = centerOf(last)
  await page.mouse.move(first.x + 1, centerOf(first).y)
  await page.mouse.down()
  await page.mouse.move(last.x + last.width - 1, lastCenter.y, { steps: RAIL_DRAG_STEPS })
  await page.mouse.up()
  // Past the end of the selected text and low in its last row, so the menu opens over blank cells.
  await page.mouse.click(
    last.x + last.width * MENU_POINTER_ACROSS_ROW,
    last.y + last.height - MENU_POINTER_ROW_INSET_PX,
    { button: 'right' },
  )
  const menu = page.getByRole('menu', { name: 'Terminal actions' })
  await menu.waitFor({ timeout: UI_TIMEOUT_MS })
  return menu
}

async function addSelectionToChat(page: Page) {
  await page.getByRole('menuitem', { name: 'Add selection to chat' }).click()
  await contextChip(page).waitFor({ timeout: UI_TIMEOUT_MS })
  await page
    .getByText('Added terminal selection to chat.')
    .waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
}

function contextChip(page: Page) {
  return page.getByText(/^Terminal · /).first()
}

/** Test output selected in the right-hand pane, with the pane's context menu open over it. */
export async function captureTerminalAddToChat(context: CaptureContext) {
  const { page } = context
  await prepareTerminal(context)
  const menu = await openSelectionMenu(page)
  const rows = testPaneRows(page)
  // The pane's header row ("Pane 2 · Shell") and its rows down to below the menu.
  const header = await regionOf(page.getByText(/^Pane 2/).first())
  // It ends on a row's lower edge, so no line of output is cut in half.
  const rowsAround = unionRegion(
    [header, await regionOf(rows.nth(MENU_CROP_LAST_ROW)), await regionOf(menu)],
    { x: MENU_CROP_MARGIN_PX, y: 0 },
  )
  const clip = {
    ...rowsAround,
    y: rowsAround.y - MENU_CROP_MARGIN_PX,
    height: rowsAround.height + MENU_CROP_MARGIN_PX,
  }
  // The pointer is parked outside the menu, so no item shows a hover state; the menu stays open.
  await shootRegion(context, 'terminal-add-to-chat.png', clip)
  await addSelectionToChat(page)
}

/** The selection as a context chip in the message box, with a question typed after it. */
export async function captureTerminalContextChip(context: CaptureContext) {
  const { page } = context
  await prepareTerminal(context)
  if ((await contextChip(page).count()) === 0) {
    await openSelectionMenu(page)
    await addSelectionToChat(page)
  }
  const input = page.getByRole('textbox', { name: 'Message input' })
  if ((await input.innerText()).trim().length === 0) {
    await input.click()
    await page.keyboard.type(CHAT_QUESTION)
  }
  const composer = await regionOf(page.locator('section[aria-label="Composer file drop zone"]'))
  await shootRegion(context, 'terminal-context-chip.png', unionRegion([composer], CROP_MARGIN_PX))
  await page.locator('header').getByRole('button', { name: 'Hide terminal' }).click()
  await removeTestFixture(context)
  await waitForUi(page)
}
