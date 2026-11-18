import { expect, type Page } from '@playwright/test'
import { SupportedModelId } from '@shared/types/brand'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  shootSettingsContent,
  unionRegion,
} from './website-screenshot-capture-kit'
import { WAGGLE_PRESET_NAME, WAGGLE_THREAD_TITLE } from './website-screenshot-feature-fixture'
import {
  lastUserText,
  type ModelScenario,
  type ScriptedReply,
} from './website-screenshot-model-server'
import {
  type CaptureContext,
  closeRightPanel,
  leaveSettings,
  openSettingsSection,
  UI_TIMEOUT_MS,
  withWindowSize,
} from './website-screenshot-ui'

const RUN_TIMEOUT_MS = 60_000
/** Settings > Waggle Mode is taller than the window; a taller window shows the whole editor. */
const WAGGLE_SETTINGS_WINDOW = { width: 1280, height: 1560 } as const
/** Each turn reports a little more context than the one before, as a real conversation does. */
const WAGGLE_TOKENS_PER_TURN = 2_600
const TWICE = 2
const METER_SIDE_PAD_PX = 6
/**
 * A smaller 16:10 window for the landing page's Waggle view, shot at twice CSS size: the frame
 * shows it at the same width as the other views, so each turn reads larger.
 */
const WAGGLE_WINDOW = { width: 1440, height: 900 } as const

/** The provider models a fresh profile needs before Waggle presets can name them. */
const WAGGLE_MODELS = [
  SupportedModelId('anthropic/claude-opus-4-6'),
  SupportedModelId('anthropic/claude-sonnet-4-6'),
] as const

async function enableWaggleModels(page: Page) {
  await page.evaluate(async (models) => {
    await window.api.setEnabledModels([...models])
    await window.api.updateSettings({ selectedModel: models[0] })
  }, WAGGLE_MODELS)
}

let wagglePresetSaved = false
let waggleRunHeld = false

/** Loads the Code Review preset and switches Agent B to another model, so it shows Edited. */
async function editWagglePreset(page: Page) {
  // Leave Settings first: the reload that picks up the enabled models keeps the current page.
  await leaveSettings(page)
  await enableWaggleModels(page)
  await page.reload()
  await page
    .getByRole('button', { name: 'Settings', exact: true })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await openSettingsSection(page, 'Waggle Mode')
  await page.getByRole('button', { name: new RegExp(`^${WAGGLE_PRESET_NAME} Sequential`) }).click()
  const modelButtons = page.getByRole('button', { name: 'Claude Opus 4.6' })
  await modelButtons.nth(1).click()
  await page.getByRole('option', { name: /^Claude Sonnet 4\.6/ }).click()
  await page.getByRole('button', { name: 'Save Changes' }).waitFor({ timeout: UI_TIMEOUT_MS })
}

async function saveWagglePreset(page: Page) {
  const save = page.getByRole('button', { name: 'Save Changes' })
  await save.click()
  await save.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  wagglePresetSaved = true
  await leaveSettings(page)
}

/**
 * Settings > Waggle Mode with the Code Review preset loaded and Agent B switched to another
 * model, so it shows Edited and Save Changes. The edit is then saved for the Waggle Run captures.
 */
export async function captureWaggleSettings(context: CaptureContext) {
  const { page } = context
  await editWagglePreset(page)
  await withWindowSize(context, WAGGLE_SETTINGS_WINDOW, async () => {
    const collaboration = await regionOf(
      page.getByRole('heading', { name: 'Collaboration' }).locator('xpath=../..'),
    )
    await shootSettingsContent(
      context,
      'settings-waggle-mode.png',
      collaboration.y + collaboration.height + TWICE * CROP_MARGIN_PX,
    )
  })
  await saveWagglePreset(page)
}

const WAGGLE_PROMPT =
  'Review the error handling in src/api/client.ts. Do not edit files. Finish with agreed findings and any unresolved disagreements.'

const WAGGLE_TURNS: Readonly<Record<number, string>> = {
  // Later turns only run after the capture releases the held one, so the Run can finish.
  1: [
    'I read `src/api/client.ts` and its two callers. Error handling is spread across three places.',
    '',
    '- `request()` turns every non-2xx response into a generic `Error`, so callers lose the status code.',
    '- `upload()` calls `fetch` directly and never retries.',
    '- The timeout timer is never cleared, so a finished request can still reject later.',
    '',
    '**Proposal:** add an `ApiError` with `status` and `requestId`, and route every call through one `send()` that owns retries.',
  ].join('\n'),
  2: [
    'I checked those claims against the code and the tests.',
    '',
    '- Confirmed: `SettingsPage` matches on the message text `"401"`.',
    '- `upload()` not retrying is deliberate: a retried upload can create a duplicate.',
    '- The timer leak is real, and `client.test.ts` has no test for it.',
    '',
    'Add `ApiError`, but keep uploads out of automatic retries.',
  ].join('\n'),
  3: [
    'That is a fair correction on uploads. Revised plan:',
    '',
    '- `send(request, { retry: false })` for uploads, retries on by default elsewhere.',
    '- `ApiError` carries the status, so `SettingsPage` can check `error.status === 401`.',
  ].join('\n'),
  4: 'I agree with the revised plan. Agreed findings: add `ApiError`, one `send()` with retries off for uploads, and a test that a timed-out request rejects once.',
}
/** The turn the capture holds open, so the Waggle status bar shows a running turn. */
const HELD_WAGGLE_TURN = 3
const WAGGLE_INPUT_TOKENS = 126_400
const TURN_PATTERN = /This is turn (\d+) of the collaboration/

/**
 * The Waggle Run's script for the shared model server. Each turn's instructions name its number,
 * which picks the text; the held turn stays open until `captureContextMeter` releases it.
 */
export const WAGGLE_SCENARIO: ModelScenario = {
  match: WAGGLE_PROMPT,
  title: WAGGLE_THREAD_TITLE,
  replies: (request) => {
    const turn = Number(TURN_PATTERN.exec(lastUserText(request))?.[1] ?? '0')
    const text = WAGGLE_TURNS[turn] ?? 'Nothing to add.'
    const inputTokens = WAGGLE_INPUT_TOKENS + turn * WAGGLE_TOKENS_PER_TURN
    return (
      turn === HELD_WAGGLE_TURN
        ? { kind: 'hold', text, inputTokens }
        : { kind: 'text', text, inputTokens }
    ) satisfies ScriptedReply
  },
}

async function startWaggleRun(page: Page) {
  await page.getByRole('button', { name: 'New session' }).first().click()
  const input = page.getByRole('textbox', { name: 'Message input' })
  await input.click()
  await page.keyboard.type('/')
  await page.getByRole('menuitem', { name: new RegExp(`^${WAGGLE_PRESET_NAME}`) }).click()
  await input.click()
  await page.keyboard.type(WAGGLE_PROMPT)
  await page.keyboard.press('Enter')
}

/**
 * Starts a live Waggle Run against the loopback model once, for the captures that need it: two
 * finished turns, and the third held open so the status bar shows a running turn.
 */
async function ensureHeldWaggleRun(context: CaptureContext) {
  const { page } = context
  if (waggleRunHeld) return
  if (!wagglePresetSaved) {
    await editWagglePreset(page)
    await saveWagglePreset(page)
  }
  await leaveSettings(page)
  await startWaggleRun(page)
  await page
    .getByText(new RegExp(`Turn ${String(HELD_WAGGLE_TURN)}/\\d+: Architect`))
    .waitFor({ timeout: RUN_TIMEOUT_MS })
  await page
    .locator('header')
    .getByText(WAGGLE_THREAD_TITLE)
    .first()
    .waitFor({ timeout: RUN_TIMEOUT_MS })
  await page
    .getByText('That is a fair correction on uploads')
    .first()
    .waitFor({ timeout: RUN_TIMEOUT_MS })
  waggleRunHeld = true
}

/**
 * A live Waggle conversation: Architect and Reviewer turns in their colours, with the status bar
 * above the message box showing the turn that is still running.
 */
export async function captureWaggleConversation(context: CaptureContext) {
  const { page } = context
  await ensureHeldWaggleRun(context)
  await closeRightPanel(page)
  // The conversation column, from the top of the transcript to the composer: the sidebar and
  // the empty margins beside the column belong to other pages.
  await shootRegion(context, 'waggle-conversation.png', async () => {
    const log = await regionOf(page.getByRole('log', { name: 'Chat messages' }))
    const composer = await regionOf(
      page.getByRole('region', { name: 'Composer file drop zone' }).locator('visible=true').first(),
    )
    const left = composer.x - CROP_MARGIN_PX
    return {
      x: left,
      y: log.y,
      width: composer.width + CROP_MARGIN_PX * TWICE,
      height: composer.y + composer.height + CROP_MARGIN_PX - log.y,
    }
  })
}

/** Space above the first turn's divider, so its label is not cut by the header. */
const FIRST_TURN_TOP_GAP_PX = 12

/** Scrolls the transcript up just far enough that Turn 1's divider is in view, not cut. */
async function showFirstTurn(page: Page) {
  const log = page.getByRole('log', { name: 'Chat messages' }).locator('visible=true').first()
  const label = log.getByText(/^Turn 1: Architect/).first()
  await label.waitFor({ timeout: UI_TIMEOUT_MS })
  const offset = (await regionOf(label)).y - (await regionOf(log)).y - FIRST_TURN_TOP_GAP_PX
  if (offset < 0) {
    await log.evaluate((scroller, by) => {
      scroller.scrollTop += by
    }, offset)
  }
  const shown = (await regionOf(label)).y - (await regionOf(log)).y
  if (shown < FIRST_TURN_TOP_GAP_PX - 1) {
    throw new Error(`Turn 1's divider is still cut off at the top of the transcript (${shown}px)`)
  }
}

/**
 * The whole window during the live Waggle Run, for the landing page's Waggle view: two agents on
 * different models taking turns, and the status bar naming both while the third turn runs.
 */
export async function captureWaggleWindow(context: CaptureContext) {
  const { page } = context
  await ensureHeldWaggleRun(context)
  await closeRightPanel(page)
  await withWindowSize(context, WAGGLE_WINDOW, async () => {
    await showFirstTurn(page)
    await shootRegion(
      context,
      'feature-waggle.png',
      { x: 0, y: 0, ...WAGGLE_WINDOW },
      { lossless: true, hideScrollbars: true },
    )
  })
}

/**
 * The context meter of the Waggle Session once its Run stopped: the ring's percentage and the
 * window's token limit, outlined. Its details are a native tooltip, which no screenshot shows.
 */
export async function captureContextMeter(context: CaptureContext) {
  const { page } = context
  await ensureHeldWaggleRun(context)
  // Let the held turn finish, so the Run ends normally and the meter reads its final usage.
  context.model.release(WAGGLE_PROMPT)
  await page
    .getByTitle('Stop & dismiss Waggle')
    .waitFor({ state: 'hidden', timeout: RUN_TIMEOUT_MS })
  waggleRunHeld = false
  const meter = page
    .getByRole('img', { name: 'Context usage meter' })
    .locator('visible=true')
    .first()
  await page.getByRole('button', { name: 'Send message' }).waitFor({ timeout: RUN_TIMEOUT_MS })
  // The ring shows the percentage once the Run's usage snapshot arrives.
  await expect(meter.locator('xpath=..')).toHaveText(/[1-9]\d*$/, { timeout: RUN_TIMEOUT_MS })
  const toolbar = page.getByTestId('composer-toolbar').locator('visible=true').first()
  // The ring and its "/ 1M" label share the element whose native tooltip holds the details.
  const gauge = meter.locator('xpath=ancestor::div[@title][1]')
  const thinking = toolbar.getByRole('button', { name: /^Thinking level/ })
  const send = toolbar.getByRole('button', { name: 'Send message' })
  // The toolbar's right end, from the thinking level to Send, with the meter outlined.
  await shootRegion(
    context,
    'context-meter.png',
    async () =>
      // Close at the sides, so neither the model picker nor the composer's edge shows.
      unionRegion([await regionOf(thinking), await regionOf(send)], {
        x: METER_SIDE_PAD_PX,
        y: CROP_MARGIN_PX / TWICE,
      }),
    { outline: await regionOf(gauge) },
  )
}
