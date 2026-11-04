import { expect, type Page } from '@playwright/test'
import { SupportedModelId } from '@shared/types/brand'
import {
  box,
  captureClip,
  CROP_MARGIN_PX,
  drawCallouts,
  leaveSettings,
  openSettingsSection,
  optimizePng,
  shootSettingsContent,
  shootWindow,
  UI_TIMEOUT_MS,
  withWindowSize,
  writeScreenshot,
} from './website-screenshot-capture-kit'
import type { FakeModelReply, FakeModelRequest } from './website-screenshot-fake-model'
import { WAGGLE_PRESET_NAME, WAGGLE_THREAD_TITLE } from './website-screenshot-feature-fixture'
import { screenshotModel } from './website-screenshot-feature-model'
import { type CaptureContext, closeRightPanel } from './website-screenshot-ui'

const RUN_TIMEOUT_MS = 60_000
/** Settings > Waggle Mode is taller than the window; a taller window shows the whole editor. */
const WAGGLE_SETTINGS_WINDOW = { width: 1280, height: 1560 } as const
/** Each turn reports a little more context than the one before, as a real conversation does. */
const WAGGLE_TOKENS_PER_TURN = 2_600
/** The context meter crop starts at the toolbar's model picker, just left of the middle. */
const METER_CROP_START = 0.45
const METER_CROP_TOP_MARGINS = 1.5
const TWICE = 2
const HALF = 0.5

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
let waggleTurnReleased = false

/** Loads the Code Review preset and switches Agent B to another model, so it shows Edited. */
async function editWagglePreset(page: Page) {
  // Leave Settings first: the reload that picks up the enabled models keeps the current page.
  await leaveSettings(page)
  await enableWaggleModels(page)
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).first().waitFor({ timeout: UI_TIMEOUT_MS })
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
    const collaboration = await box(
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
    "Add `ApiError`, but keep uploads out of automatic retries.",
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

function waggleReply(request: FakeModelRequest): FakeModelReply {
  if (!request.hasTools) {
    return { text: JSON.stringify({ title: WAGGLE_THREAD_TITLE, needsRefinement: false }) }
  }
  const turn = Number(TURN_PATTERN.exec(request.lastUserText)?.[1] ?? '0')
  return {
    text: WAGGLE_TURNS[turn] ?? 'Nothing to add.',
    inputTokens: WAGGLE_INPUT_TOKENS + turn * WAGGLE_TOKENS_PER_TURN,
    hold: turn === HELD_WAGGLE_TURN && !waggleTurnReleased,
  }
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
  screenshotModel().setResponder(waggleReply)
  await leaveSettings(page)
  await startWaggleRun(page)
  await page
    .getByText(new RegExp(`Turn ${String(HELD_WAGGLE_TURN)}/\\d+: Architect`))
    .waitFor({ timeout: RUN_TIMEOUT_MS })
  await page.locator('header').getByText(WAGGLE_THREAD_TITLE).first().waitFor({ timeout: RUN_TIMEOUT_MS })
  await page.getByText('That is a fair correction on uploads').first().waitFor({ timeout: RUN_TIMEOUT_MS })
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
  await shootWindow(context, 'waggle-conversation.png')
}

/**
 * The context meter of the Waggle Session once its Run stopped, with numbered markers for the
 * ring's percentage and the window's token limit.
 */
export async function captureContextMeter(context: CaptureContext) {
  const { page } = context
  await ensureHeldWaggleRun(context)
  // Let the held turn finish, so the Run ends normally and the meter reads its final usage.
  waggleTurnReleased = true
  screenshotModel().release()
  await page.getByTitle('Stop & dismiss Waggle').waitFor({ state: 'hidden', timeout: RUN_TIMEOUT_MS })
  waggleRunHeld = false
  const meter = page.getByRole('img', { name: 'Context usage meter' }).locator('visible=true').first()
  await page.getByRole('button', { name: 'Send message' }).waitFor({ timeout: RUN_TIMEOUT_MS })
  // The ring shows the percentage once the Run's usage snapshot arrives.
  await expect(meter.locator('xpath=..')).toHaveText(/[1-9]\d*$/, { timeout: RUN_TIMEOUT_MS })
  const composer = await box(page.getByRole('region', { name: 'Composer file drop zone' }))
  const ring = await box(meter)
  const limit = await box(page.getByText(/^\/ \d/).last())
  const left = composer.x + composer.width * METER_CROP_START
  // From just above the toolbar row: the empty message box above it adds nothing.
  const top = ring.y - METER_CROP_TOP_MARGINS * CROP_MARGIN_PX
  const clip = {
    x: left,
    y: top,
    width: composer.x + composer.width + CROP_MARGIN_PX - left,
    height: composer.y + composer.height + CROP_MARGIN_PX - top,
  }
  const image = await captureClip(page, clip)
  // The markers sit in a band added under the crop, so they never cover what they point to.
  const withCallouts = await drawCallouts(image, clip, [
    { label: '1', x: ring.x + ring.width * HALF - clip.x, pointsToY: ring.y + ring.height - clip.y },
    { label: '2', x: limit.x + limit.width * HALF - clip.x, pointsToY: limit.y + limit.height - clip.y },
  ])
  await writeScreenshot(context, 'context-meter.png', await optimizePng(withCallouts))
}
