import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { SupportedModelId } from '@shared/types/brand'
import {
  seedEssentialsSessions,
  TOOL_ROWS_SESSION_TITLE,
} from './website-screenshot-essentials-fixture'
import {
  createEssentialsProject,
  ESSENTIALS_PROJECT_NAME,
  type EssentialsProject,
} from './website-screenshot-essentials-project'
import {
  APPROVAL_PROMPT,
  APPROVAL_TITLE,
  ERROR_PROMPT,
  ERROR_TITLE,
  WORKING_FOLLOW_UPS,
  WORKING_PROMPT,
  WORKING_TITLE,
} from './website-screenshot-essentials-scenarios'
import { FIXTURE_MODEL_REF } from './website-screenshot-pi-agent'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  showRailSurface,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

/** The smaller crop margins where a neighbour sits close. */
export const SIDEBAR_PAD_PX = 8
export const TIGHT_PAD_PX = 6

/** Models the composer and Settings > Connections list as enabled. */
const ENABLED_MODELS = [
  FIXTURE_MODEL_REF,
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-6',
] as const

interface EssentialsState {
  readonly project: EssentialsProject
}

const prepared = new WeakMap<Page, Promise<EssentialsState>>()

/**
 * The essentials fixture, built once per run by whichever essentials capture comes first, after
 * the other captures: a second project with its own Sessions, so the first project's images do
 * not change, and settings that make the composer show Ask for approval and the fixture model.
 */
async function prepare(context: CaptureContext) {
  const { userDataDir, homeDir } = context
  const project = await createEssentialsProject({
    scratchRoot: path.dirname(userDataDir),
    homeDir,
  })
  await seedEssentialsSessions(userDataDir, project)
  await context.page.evaluate(
    async ({ projectPath, projectName, enabledModels, model }) => {
      const settings = await window.api.getSettings()
      await window.api.updateSettings({
        projectPath,
        recentProjects: [
          projectPath,
          ...settings.recentProjects.filter((entry) => entry !== projectPath),
        ],
        projectDisplayNames: { ...settings.projectDisplayNames, [projectPath]: projectName },
        enabledModels: [...enabledModels],
        selectedModel: model,
        sessionTitleModel: model,
        defaultAuthorizationMode: 'ask-for-approval',
      })
    },
    {
      projectPath: project.projectPath,
      projectName: ESSENTIALS_PROJECT_NAME,
      enabledModels: ENABLED_MODELS.map((model) => SupportedModelId(model)),
      model: SupportedModelId(FIXTURE_MODEL_REF),
    },
  )
  await context.page.reload()
  await expect(
    sidebar(context.page).getByRole('button', { name: TOOL_ROWS_SESSION_TITLE, exact: true }),
  ).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  return { project } satisfies EssentialsState
}

export function prepareEssentials(context: CaptureContext) {
  const existing = prepared.get(context.page)
  if (existing) return existing
  const next = prepare(context)
  prepared.set(context.page, next)
  return next
}

export function sidebar(page: Page) {
  return page.getByRole('navigation', { name: 'Sidebar' })
}

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Message input' })
}

/** A new-session draft in the essentials project, with nothing typed. */
export async function openDraft(page: Page) {
  // The project heading's own New session: the sidebar's one drafts in the open Session's
  // project, and opening a jotter Session first would clear its Done state.
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: `New session in ${ESSENTIALS_PROJECT_NAME}`, exact: true })
    .click()
  await page
    .locator('header')
    .getByText(ESSENTIALS_PROJECT_NAME, { exact: true })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await page
    .getByRole('button', { name: /^Session environment mode/ })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await page
    .getByTestId('composer-toolbar')
    .getByRole('button', { name: /GPT-5\.4/ })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
}

/** Types a message into the composer and sends it. */
export async function sendMessage(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Enter')
}

/** Starts a Session with its first message and waits for the Title model's title. */
async function startSession(page: Page, prompt: string, title: string) {
  await openDraft(page)
  await sendMessage(page, prompt)
  await page
    .locator('header')
    .getByText(title, { exact: true })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
}

const liveSessions = new WeakMap<Page, Promise<void>>()

/**
 * Real Runs against the scripted model, in the states the sidebar shows: one waiting on an
 * approval (Input), one still working with follow-ups queued (Working), and one the provider
 * refused (Error). Started once, by the first capture that needs them.
 */
async function startLiveSessions(context: CaptureContext) {
  await prepareEssentials(context)
  const { page } = context
  // The provider refuses this one a few seconds later, while the next Session is open.
  await startSession(page, ERROR_PROMPT, ERROR_TITLE)
  await startSession(page, APPROVAL_PROMPT, APPROVAL_TITLE)
  await page
    .getByRole('button', { name: 'Allow once', exact: true })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await startSession(page, WORKING_PROMPT, WORKING_TITLE)
  await page.getByText('Thinking', { exact: true }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  for (const followUp of WORKING_FOLLOW_UPS) {
    await sendMessage(page, followUp)
    await page.getByText(followUp, { exact: true }).first().waitFor({ timeout: UI_TIMEOUT_MS })
  }
  await sidebar(page)
    .getByRole('listitem')
    .filter({ hasText: ERROR_TITLE })
    .getByText('Error', { exact: true })
    .waitFor({ timeout: UI_TIMEOUT_MS })
}

export function ensureLiveSessions(context: CaptureContext) {
  const existing = liveSessions.get(context.page)
  if (existing) return existing
  const next = startLiveSessions(context)
  liveSessions.set(context.page, next)
  return next
}

const SETTLE_TIMEOUT_MS = 10_000

/** Cancels a Session's active Run from its composer, after pausing any queued Follow-ups. */
async function cancelRun(page: Page, title: string) {
  await openSession(page, title)
  const pause = page.getByTitle(/^Pause Follow-up delivery/)
  if ((await pause.count()) > 0) await pause.click()
  const cancel = page.getByTestId('composer-toolbar').getByTitle('Cancel', { exact: true })
  if ((await cancel.count()) === 0) return
  await cancel.click()
  await cancel.waitFor({ state: 'detached', timeout: SETTLE_TIMEOUT_MS })
}

/**
 * Ends what the essentials captures left running, so the Session Host can drain: the busy and
 * the waiting Runs, and the dev server action. Does nothing when the essentials never ran.
 */
export async function settleEssentials(page: Page) {
  if (!prepared.has(page)) return
  if (liveSessions.has(page)) {
    await cancelRun(page, WORKING_TITLE)
    await cancelRun(page, APPROVAL_TITLE)
  }
  // A running action keeps the Host from draining.
  await openSession(page, TOOL_ROWS_SESSION_TITLE)
  await showRailSurface(page, 'Project Actions')
  const stopDevServer = page.getByRole('button', { name: 'Stop Dev server', exact: true })
  if ((await stopDevServer.count()) > 0) {
    await stopDevServer.click()
    await stopDevServer.waitFor({ state: 'detached', timeout: SETTLE_TIMEOUT_MS })
  }
  await closeRightPanel(page)
}
