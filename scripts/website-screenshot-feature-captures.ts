import {
  around,
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  shootSettingsContent,
} from './website-screenshot-capture-kit'
import {
  CODEMODE_THREAD_TITLE,
  COMPACTION_THREAD_TITLE,
  MISSING_WORKTREE_THREAD_TITLE,
} from './website-screenshot-feature-fixture'
import { THREAD_TITLE } from './website-screenshot-fixture'
import {
  type CaptureContext,
  closeRightPanel,
  leaveSettings,
  openSession,
  openSettingsSection,
  setSessionSummary,
  showRailSurface,
  UI_TIMEOUT_MS,
  withWindowSize,
} from './website-screenshot-ui'

/** Smaller windows for Settings pages, so their content is not stretched across 1600 pixels. */
const SETTINGS_WINDOW = { width: 1280, height: 800 } as const
const NARROW_SETTINGS_WINDOW = { width: 1100, height: 700 } as const
const ALL_PANELS_WINDOW = { width: 1600, height: 720 } as const
/** Tall enough for the expanded codemode card, its output and the reply under it. */
const CODEMODE_WINDOW = { width: 1600, height: 1240 } as const
/** The widest the compaction crop gets: the transcript column, not the empty space beside it. */
const COMPACTION_CROP_MAX_WIDTH_PX = 720
/** Where the Skills and Agents crops end, below their selected item's preview. */
const SKILLS_CROP_BOTTOM_PX = 520
const AGENTS_CROP_BOTTOM_PX = 700
/** Half the usual crop margin, where a neighbour sits close. */
const TIGHT_MARGIN_PX = 8
const THRICE = 3

/** Seeds the feature Sessions on first use and reloads, so the sidebar lists them. */
async function openFeatureSession(context: CaptureContext, title: string) {
  const { page } = context
  await leaveSettings(page)
  if (await context.seedFeatureSessionsOnce()) {
    await page.reload()
    await page
      .getByRole('button', { name: 'New session' })
      .first()
      .waitFor({ timeout: UI_TIMEOUT_MS })
  }
  await openSession(page, title)
}

/** The Right panel's All panels list beside its rail, cropped to the panel. */
export async function captureAllPanels(context: CaptureContext) {
  const { page } = context
  await leaveSettings(page)
  await openSession(page, THREAD_TITLE)
  await setSessionSummary(page, false)
  await withWindowSize(context, ALL_PANELS_WINDOW, async () => {
    await showRailSurface(page, 'All panels')
    const panel = await regionOf(page.getByRole('region', { name: 'All panels' }))
    await shootRegion(
      context,
      'right-panel-all-panels.png',
      {
        x: panel.x,
        y: 0,
        width: ALL_PANELS_WINDOW.width - panel.x,
        height: ALL_PANELS_WINDOW.height,
      },
      { hideScrollbars: true },
    )
  })
  await closeRightPanel(page)
}

/** A finished codemode call, expanded to show its tool calls, script and output. */
export async function captureCodemodeCard(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(context, CODEMODE_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  await withWindowSize(context, CODEMODE_WINDOW, async () => {
    const expandTurn = page.getByRole('button', { name: 'Expand turn details' }).first()
    await expandTurn.click({ timeout: UI_TIMEOUT_MS })
    const card = page.getByRole('button', { name: /^Ran a script/ }).first()
    await card.click({ timeout: UI_TIMEOUT_MS })
    await page
      .getByRole('region', { name: 'Script output' })
      .or(page.getByLabel('Script output'))
      .first()
      .waitFor({ timeout: UI_TIMEOUT_MS })
    const cardRoot = card.locator('xpath=..')
    await shootRegion(context, 'codemode-script-card.png', around(await regionOf(cardRoot)), {
      hideScrollbars: true,
    })
  })
}

/** The Context compacted marker between the messages before and after a manual compaction. */
export async function captureCompactionMarker(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(context, COMPACTION_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  const transcript = await regionOf(page.getByRole('log', { name: 'Chat messages' }))
  const firstReply = await regionOf(page.getByText('Still to do:', { exact: false }).first())
  // Tight above and below, so the neighbouring bullet and the message actions stay out.
  const tight = TIGHT_MARGIN_PX
  const lastReply = await regionOf(page.getByText('passes: 14 tests', { exact: false }).first())
  const column = await regionOf(page.locator('[data-compaction-timeline-state]').first())
  const left = column.x - CROP_MARGIN_PX
  await shootRegion(
    context,
    'context-compacted.png',
    {
      x: left,
      y: firstReply.y - tight,
      width: Math.min(transcript.x + transcript.width, left + COMPACTION_CROP_MAX_WIDTH_PX) - left,
      height: lastReply.y + lastReply.height + tight - (firstReply.y - tight),
    },
    { hideScrollbars: true },
  )
}

/** The missing-worktree notice above the message box, with its two recovery actions. */
export async function captureMissingWorktree(context: CaptureContext) {
  const { page } = context
  await openFeatureSession(context, MISSING_WORKTREE_THREAD_TITLE)
  await closeRightPanel(page)
  await setSessionSummary(page, false)
  const notice = await regionOf(
    page.getByRole('button', { name: 'Recreate worktree' }).locator('xpath=../..'),
  )
  const composer = await regionOf(page.getByRole('region', { name: 'Composer file drop zone' }))
  const top = notice.y - CROP_MARGIN_PX
  const left = Math.min(notice.x, composer.x) - CROP_MARGIN_PX
  const right = Math.max(notice.x + notice.width, composer.x + composer.width) + CROP_MARGIN_PX
  await shootRegion(
    context,
    'missing-worktree.png',
    {
      x: left,
      y: top,
      width: right - left,
      height: composer.y + composer.height + CROP_MARGIN_PX - top,
    },
    { hideScrollbars: true },
  )
}

/** Settings > Skills with a project skill selected. */
export async function captureSettingsSkills(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Skills')
  await page
    .getByRole('button', { name: /review-change/ })
    .first()
    .click({ timeout: UI_TIMEOUT_MS })
  await page
    .getByText('Read the diff and the affected callers', { exact: false })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, () =>
    shootSettingsContent(context, 'settings-skills.png', SKILLS_CROP_BOTTOM_PX),
  )
}

/** Settings > Agents with a project agent definition selected. */
export async function captureSettingsAgents(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Agents')
  await page
    .getByRole('button', { name: /release-verifier/ })
    .first()
    .click({ timeout: UI_TIMEOUT_MS })
  await page
    .getByText('Work through the release checklist', { exact: false })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, () =>
    shootSettingsContent(context, 'settings-agents.png', AGENTS_CROP_BOTTOM_PX),
  )
}

/** Settings > Permissions: the default access mode, the project override and saved approvals. */
export async function captureSettingsPermissions(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Permissions')
  await withWindowSize(context, NARROW_SETTINGS_WINDOW, async () => {
    const emptyState = await regionOf(page.getByText(/no saved approvals/i).first())
    await shootSettingsContent(
      context,
      'settings-permissions.png',
      emptyState.y + emptyState.height + THRICE * CROP_MARGIN_PX,
    )
  })
}

/** Settings > Shortcuts: search, then the Panels group with its bindings. */
export async function captureSettingsShortcuts(context: CaptureContext) {
  const { page } = context
  await openSettingsSection(page, 'Shortcuts')
  await page
    .getByRole('heading', { name: 'Keyboard shortcuts' })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await withWindowSize(context, SETTINGS_WINDOW, async () => {
    // End below a whole row rather than halfway through the next one.
    const row = await regionOf(page.getByText('Inspect branches and session history').first())
    await shootSettingsContent(
      context,
      'settings-shortcuts.png',
      row.y + row.height + CROP_MARGIN_PX,
    )
  })
}
