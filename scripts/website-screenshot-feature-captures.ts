import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { SupportedModelId } from '@shared/types/brand'
import sharp, { type Sharp } from 'sharp'
import { THREAD_TITLE } from './website-screenshot-fixture'
import type { FakeModelReply, FakeModelRequest } from './website-screenshot-fake-model'
import {
  CODEMODE_THREAD_TITLE,
  COMPACTION_THREAD_TITLE,
  MISSING_WORKTREE_THREAD_TITLE,
  WAGGLE_PRESET_NAME,
  WAGGLE_THREAD_TITLE,
  seedFeatureSessionsOnce,
} from './website-screenshot-feature-fixture'
import { screenshotModel } from './website-screenshot-feature-model'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import {
  type CaptureContext,
  blurFocusedControl,
  closeRightPanel,
  openSession,
  setSessionSummary,
  showRailSurface,
  waitForUi,
} from './website-screenshot-ui'

const UI_TIMEOUT_MS = 30_000
const RUN_TIMEOUT_MS = 60_000
const WINDOW_WIDTH_PX = 1600
const WINDOW_HEIGHT_PX = 1000
/** Settings > Waggle Mode is taller than the window; a taller window shows the whole editor. */
const WAGGLE_SETTINGS_WINDOW = { width: 1280, height: 1560 } as const
/** Crops are taken at device scale (2x on Retina) and scaled to at most this width. */
const MAX_CROP_WIDTH_PX = 1600
const CROP_MARGIN_PX = 16
const CALLOUT_RADIUS_PX = 15
const CALLOUT_FONT_PX = 17
const CALLOUT_GAP_PX = 4
const CALLOUT_BAND_PX = 48
/** Smaller windows for Settings pages, so their content is not stretched across 1600 pixels. */
const SETTINGS_WINDOW = { width: 1280, height: 800 } as const
const NARROW_SETTINGS_WINDOW = { width: 1100, height: 700 } as const
const ALL_PANELS_WINDOW = { width: 1600, height: 720 } as const

interface Clip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A palette PNG keeps flat UI captures well under the website's size budget. */
async function optimizePng(image: Buffer | Sharp) {
  const pipeline = Buffer.isBuffer(image) ? sharp(image) : image
  const metadata = await pipeline.clone().metadata()
  const resized =
    metadata.width !== undefined && metadata.width > MAX_CROP_WIDTH_PX
      ? pipeline.resize({ width: MAX_CROP_WIDTH_PX })
      : pipeline
  return resized.png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer()
}

async function writeScreenshot(context: CaptureContext, file: WebsiteScreenshot, image: Buffer) {
  const target = path.join(context.outputDir, file)
  await fs.writeFile(target, image)
  await fs.copyFile(target, path.join(context.evidenceDir, file))
  console.info(`[website-shots] wrote ${file}`)
}

async function settle(page: Page) {
  await page.mouse.move(1, 1)
  await blurFocusedControl(page)
}

/**
 * A region of the window at device scale, so small controls stay sharp. A cropped page keeps
 * its overlay scrollbar at the crop's edge, where it reads as a stray line, so it is hidden.
 */
async function captureClip(page: Page, clip: Clip) {
  await settle(page)
  return page.screenshot({
    clip,
    animations: 'disabled',
    scale: 'device',
    style: '::-webkit-scrollbar { display: none !important; }',
  })
}

async function shootClip(context: CaptureContext, file: WebsiteScreenshot, clip: Clip) {
  await writeScreenshot(context, file, await optimizePng(await captureClip(context.page, clip)))
}

async function shootWindow(context: CaptureContext, file: WebsiteScreenshot) {
  await settle(context.page)
  const image = await context.page.screenshot({ animations: 'disabled', scale: 'css' })
  await writeScreenshot(context, file, await optimizePng(image))
}

async function box(locator: Locator) {
  await locator.waitFor({ timeout: UI_TIMEOUT_MS })
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('A screenshot target has no bounding box.')
  return bounds
}

function around(bounds: Clip, margin = CROP_MARGIN_PX): Clip {
  return {
    x: Math.max(0, bounds.x - margin),
    y: Math.max(0, bounds.y - margin),
    width: bounds.width + 2 * margin,
    height: bounds.height + 2 * margin,
  }
}

async function setWindowSize(context: CaptureContext, size: { width: number; height: number }) {
  await context.app.evaluate(async ({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setBounds(bounds)
  }, size)
  await context.page.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    size,
  )
  await waitForUi(context.page)
}

async function openSettingsSection(page: Page, section: string) {
  const back = page.getByRole('button', { name: 'Back to app' })
  if (!(await back.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await page.getByRole('button', { name: section, exact: true }).first().click()
  await waitForUi(page)
}

/** Seeds the feature Sessions on first use and reloads, so the sidebar lists them. */
async function openFeatureSession(page: Page, title: string) {
  await leaveSettings(page)
  if (await seedFeatureSessionsOnce()) {
    await page.reload()
    await page.getByRole('button', { name: 'New session' }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  }
  await openSession(page, title)
}

async function leaveSettings(page: Page) {
  const back = page.getByRole('button', { name: 'Back to app' })
  if (await back.isVisible()) await back.click()
  await waitForUi(page)
}

interface Callout {
  readonly label: string
  /** Horizontal centre of the marker and the bottom of what it points to, in CSS pixels of the clip. */
  readonly x: number
  readonly pointsToY: number
}

/**
 * Numbered markers in a band added under a crop, each with a short line up to the element it
 * names. Positions come from the elements' bounding boxes, so the numbers land in the same place
 * on every run and never cover the control.
 */
async function drawCallouts(image: Buffer, clip: Clip, callouts: readonly Callout[]) {
  const metadata = await sharp(image).metadata()
  const width = metadata.width ?? clip.width
  const height = metadata.height ?? clip.height
  const scale = width / clip.width
  const band = CALLOUT_BAND_PX * scale
  const { data } = await sharp(image).extract({ left: 0, top: height - 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  const background = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, alpha: 1 }
  const markers = callouts
    .map(({ label, x, pointsToY }) => {
      const cx = x * scale
      const r = CALLOUT_RADIUS_PX * scale
      const cy = height + band / 2
      return [
        `<line x1="${String(cx)}" y1="${String(cy - r)}" x2="${String(cx)}" y2="${String((pointsToY + CALLOUT_GAP_PX) * scale)}" stroke="#f5a524" stroke-width="${String(2 * scale)}"/>`,
        `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" fill="#f5a524"/>`,
        `<text x="${String(cx)}" y="${String(cy)}" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${String(CALLOUT_FONT_PX * scale)}" fill="#14161a">${label}</text>`,
      ].join('')
    })
    .join('')
  const extendedHeight = height + Math.round(band)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(extendedHeight)}">${markers}</svg>`
  const extended = await sharp(image)
    .extend({ bottom: Math.round(band), background })
    .png()
    .toBuffer()
  return sharp(extended).composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
}

/** Runs a capture at another window size, then restores the standard one. */
async function withWindowSize<T>(
  context: CaptureContext,
  size: { width: number; height: number },
  capture: () => Promise<T>,
) {
  await setWindowSize(context, size)
  try {
    return await capture()
  } finally {
    await setWindowSize(context, { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX })
  }
}

/** The settings content to the right of the section list, at device scale. */
async function shootSettingsContent(
  context: CaptureContext,
  file: WebsiteScreenshot,
  bottom?: number,
) {
  const { page } = context
  const navigation = await box(page.getByRole('navigation').filter({ hasText: 'Permissions' }).last())
  const viewport = page.viewportSize() ?? { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX }
  const left = navigation.x + navigation.width
  await shootClip(context, file, {
    x: left,
    y: navigation.y,
    width: viewport.width - left,
    height: (bottom ?? viewport.height) - navigation.y,
  })
}

/** The Right panel's All panels list beside its rail, cropped to the panel. */
export async function captureAllPanels(context: CaptureContext) {
  const { page } = context
  await leaveSettings(page)
  await openSession(page, THREAD_TITLE)
  await setSessionSummary(page, false)
  await withWindowSize(context, ALL_PANELS_WINDOW, async () => {
    await showRailSurface(page, 'All panels')
    const panel = await box(page.getByRole('region', { name: 'All panels' }))
    await shootClip(context, 'right-panel-all-panels.png', {
      x: panel.x,
      y: 0,
      width: ALL_PANELS_WINDOW.width - panel.x,
      height: ALL_PANELS_WINDOW.height,
    })
  })
  await closeRightPanel(page)
}

/** A finished codemode call, expanded to show its tool calls, script and output. */
export async function captureCodemodeCard(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(page, CODEMODE_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  const expandTurn = page.getByRole('button', { name: 'Expand turn details' }).first()
  await expandTurn.click({ timeout: UI_TIMEOUT_MS })
  const card = page.getByRole('button', { name: /^Ran a script/ }).first()
  await card.click({ timeout: UI_TIMEOUT_MS })
  await page.getByRole('region', { name: 'Script output' }).or(page.getByLabel('Script output')).first().waitFor({ timeout: UI_TIMEOUT_MS })
  const cardRoot = card.locator('xpath=..')
  await shootClip(context, 'codemode-script-card.png', around(await box(cardRoot)))
}

/** The Context compacted marker between the messages before and after a manual compaction. */
export async function captureCompactionMarker(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(page, COMPACTION_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  const transcript = await box(page.getByRole('log', { name: 'Chat messages' }))
  const firstReply = await box(page.getByText('Still to do:', { exact: false }).first())
  // Tight above and below, so the neighbouring bullet and the message actions stay out.
  const tight = CROP_MARGIN_PX / 2
  const lastReply = await box(page.getByText('passes: 14 tests', { exact: false }).first())
  const column = await box(page.locator('[data-compaction-timeline-state]').first())
  const left = column.x - CROP_MARGIN_PX
  await shootClip(context, 'context-compacted.png', {
    x: left,
    y: firstReply.y - tight,
    width: Math.min(transcript.x + transcript.width, left + 720) - left,
    height: lastReply.y + lastReply.height + tight - (firstReply.y - tight),
  })
}

/** The missing-worktree notice above the message box, with its two recovery actions. */
export async function captureMissingWorktree(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(page, MISSING_WORKTREE_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  const notice = await box(page.getByRole('button', { name: 'Recreate worktree' }).locator('xpath=../..'))
  const composer = await box(page.getByRole('region', { name: 'Composer file drop zone' }))
  const top = notice.y - CROP_MARGIN_PX
  const left = Math.min(notice.x, composer.x) - CROP_MARGIN_PX
  const right = Math.max(notice.x + notice.width, composer.x + composer.width) + CROP_MARGIN_PX
  await shootClip(context, 'missing-worktree.png', {
    x: left,
    y: top,
    width: right - left,
    height: composer.y + composer.height + CROP_MARGIN_PX - top,
  })
}

/** Settings > Skills with a project skill selected. */
export async function captureSettingsSkills(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Skills')
  await page.getByRole('button', { name: /review-change/ }).first().click({ timeout: UI_TIMEOUT_MS })
  await page.getByText('Read the diff and the affected callers', { exact: false }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, () => shootSettingsContent(context, 'settings-skills.png', 520))
}

/** Settings > Agents with a project agent definition selected. */
export async function captureSettingsAgents(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Agents')
  await page.getByRole('button', { name: /release-verifier/ }).first().click({ timeout: UI_TIMEOUT_MS })
  await page.getByText('Work through the release checklist', { exact: false }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, () => shootSettingsContent(context, 'settings-agents.png', 700))
}

/** Settings > Permissions: the default access mode, the project override and saved approvals. */
export async function captureSettingsPermissions(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Permissions')
  await withWindowSize(context, NARROW_SETTINGS_WINDOW, async () => {
    const emptyState = await box(page.getByText(/no saved approvals/i).first())
    await shootSettingsContent(context, 'settings-permissions.png', emptyState.y + emptyState.height + 3 * CROP_MARGIN_PX)
  })
}

/** Settings > Shortcuts: search, then the Panels group with its bindings. */
export async function captureSettingsShortcuts(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Shortcuts')
  await page.getByRole('heading', { name: 'Keyboard shortcuts' }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, async () => {
    // End below a whole row rather than halfway through the next one.
    const row = await box(page.getByText('Inspect branches and session history').first())
    await shootSettingsContent(
      context,
      'settings-shortcuts.png',
      row.y + row.height + CROP_MARGIN_PX,
    )
  })
}

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
      collaboration.y + collaboration.height + 2 * CROP_MARGIN_PX,
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
    inputTokens: WAGGLE_INPUT_TOKENS + turn * 2_600,
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
  const left = composer.x + composer.width * 0.45
  // From just above the toolbar row: the empty message box above it adds nothing.
  const top = ring.y - 1.5 * CROP_MARGIN_PX
  const clip = {
    x: left,
    y: top,
    width: composer.x + composer.width + CROP_MARGIN_PX - left,
    height: composer.y + composer.height + CROP_MARGIN_PX - top,
  }
  const image = await captureClip(page, clip)
  // The markers sit in a band added under the crop, so they never cover what they point to.
  const withCallouts = await drawCallouts(image, clip, [
    { label: '1', x: ring.x + ring.width / 2 - clip.x, pointsToY: ring.y + ring.height - clip.y },
    { label: '2', x: limit.x + limit.width / 2 - clip.x, pointsToY: limit.y + limit.height - clip.y },
  ])
  await writeScreenshot(context, 'context-meter.png', await optimizePng(withCallouts))
}
