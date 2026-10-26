import { THREAD_TITLE } from './website-screenshot-fixture'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  setSessionSummary,
  shoot,
  showRailSurface,
  waitForGitStatus,
  waitForUi,
} from './website-screenshot-ui'

const GIT_READY_TIMEOUT_MS = 120_000
const UI_TIMEOUT_MS = 30_000

async function openThread(context: CaptureContext) {
  await openSession(context.page, THREAD_TITLE)
  await closeRightPanel(context.page)
  await setSessionSummary(context.page, false)
  await waitForGitStatus(context.page)
}

/** A Waggle conversation: the landing page's Conversation view. */
export async function captureCodingAgent(context: CaptureContext) {
  await openThread(context)
  await shoot(context, 'feature-coding-agent.png')
}

/** The Changes panel with the fixture's uncommitted README edit. */
export async function captureGitWorkflow(context: CaptureContext) {
  const { page } = context
  await openThread(context)
  await showRailSurface(page, 'Changes')
  await page.getByRole('button', { name: /Stage all/ }).waitFor({ timeout: UI_TIMEOUT_MS })
  await page.locator('.diff-chrome').first().waitFor({ timeout: GIT_READY_TIMEOUT_MS })
  await shoot(context, 'feature-git-workflow.png')
  await closeRightPanel(page)
}

/** The Session Tree panel used by the session-tree guide and the Waggle view. */
export async function captureSessionTree(context: CaptureContext) {
  const { page } = context
  await openThread(context)
  await showRailSurface(page, 'Session Tree')
  await page.getByRole('region', { name: 'Session Tree' }).waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  await shoot(context, 'session-tree-panel.png')
  await closeRightPanel(page)
}
