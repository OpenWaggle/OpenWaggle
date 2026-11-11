import type { Locator, Page } from '@playwright/test'
import {
  around,
  regionOf,
  settleForShot,
  shootRegion,
  writeScreenshot,
} from './website-screenshot-capture-kit'
import {
  deleteFixtureExtension,
  FIXTURE_EXTENSION_NAME,
  FIXTURE_REPOSITORY,
  GITHUB_API_URL_PATTERN,
  githubIssuesFixture,
  installFixtureExtension,
} from './website-screenshot-extension-fixture'
import { HIVE_QUEEN_TITLE } from './website-screenshot-hive-fixture'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import {
  type CaptureContext,
  closeRightPanel,
  openSession,
  showRailSurface,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

const HTTP_OK = 200
/** Settings > Extensions titles its page with an h2 and each package card with an h3. */
const PAGE_HEADING_LEVEL = 2
const PACKAGE_HEADING_LEVEL = 3
/** Space kept between the crop's bottom edge and the Save button it leaves out. */
const SAVE_BUTTON_GAP_PX = 6
/** Text every issue-summary surface of the fixture shows once it has read `githubIssuesFixture`. */
const SUMMARY_TEXT = '6 open, 3 ready-for-agent, 1 stale'
const FIRST_ISSUE_TEXT = '#2184 Remember the last Settings section per window'

/** The sandboxed frame an extension contribution renders into, inside one host surface. */
function extensionFrame(surface: Locator, contributionTitle: string) {
  return surface.locator(`iframe[title="Extension module: ${contributionTitle}"]`).contentFrame()
}

function packageButton(page: Page, action: string) {
  return page.getByRole('button', { name: `${action} ${FIXTURE_EXTENSION_NAME}`, exact: true })
}

function settingsContributions(page: Page) {
  return page.getByRole('region', { name: 'Extension settings contributions' })
}

/** The fixture settings form's button, shown once its frame has loaded every module. */
function settingsSave(page: Page) {
  return extensionFrame(settingsContributions(page), 'GitHub Issues Settings').getByRole('button', {
    name: 'Save configuration',
  })
}

/** Saves the made-up repository in the fixture's settings form, so no surface shows a real one. */
async function useFixtureRepository(page: Page) {
  const form = extensionFrame(settingsContributions(page), 'GitHub Issues Settings')
  await form.getByLabel('Repository owner').fill(FIXTURE_REPOSITORY.owner)
  await form.getByLabel('Repository name').fill(FIXTURE_REPOSITORY.repo)
  await settingsSave(page).click()
  await form.getByText(/^Configuration saved\./).waitFor({ timeout: UI_TIMEOUT_MS })
}

/** The package's card in Settings > Extensions. */
function packageCard(page: Page) {
  return page
    .locator('div')
    .filter({
      has: page.getByRole('heading', {
        name: FIXTURE_EXTENSION_NAME,
        level: PACKAGE_HEADING_LEVEL,
      }),
    })
    .filter({ has: packageButton(page, 'Remove') })
    .last()
}

async function projectPath(page: Page) {
  const settings = await page.evaluate(() => window.api.getSettings())
  if (!settings.projectPath) throw new Error('The screenshot profile has no project selected.')
  return settings.projectPath
}

function extensionsHeading(page: Page) {
  return page.getByRole('heading', { name: 'Extensions', level: PAGE_HEADING_LEVEL })
}

async function openExtensionsSettings(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
  await sidebar.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Extensions', exact: true }).click()
  await extensionsHeading(page).waitFor({ timeout: UI_TIMEOUT_MS })
}

async function backToApp(page: Page) {
  await page.getByRole('button', { name: 'Back to app' }).click()
  await page
    .getByRole('button', { name: 'New session' })
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
}

const routedPages = new WeakSet<Page>()

/**
 * The fixture reads public GitHub issues; the capture answers those requests itself, so the images
 * never depend on the network or show live data. The route stays for the rest of the run:
 * `unroute` on the app window's context hung under Electron, and nothing else calls GitHub.
 */
async function answerGithubWithFixture(page: Page) {
  if (routedPages.has(page)) return
  routedPages.add(page)
  const now = Date.now()
  await page.context().route(GITHUB_API_URL_PATTERN, (route) =>
    route.fulfill({
      status: HTTP_OK,
      contentType: 'application/json',
      body: JSON.stringify(githubIssuesFixture(now)),
    }),
  )
}

/** Installs the development fixture in the project and shows its card in Settings > Extensions. */
async function installAndDiscover(page: Page) {
  await answerGithubWithFixture(page)
  await installFixtureExtension(await projectPath(page))
  await openExtensionsSettings(page)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await packageCard(page).waitFor({ timeout: UI_TIMEOUT_MS })
}

/** Trust, Enable, then Reload, from whatever lifecycle state an earlier capture left. */
async function loadFixtureExtension(page: Page) {
  if (await packageButton(page, 'Trust').isVisible()) await packageButton(page, 'Trust').click()
  await packageButton(page, 'Untrust').waitFor({ timeout: UI_TIMEOUT_MS })
  if (await packageButton(page, 'Enable').isVisible()) await packageButton(page, 'Enable').click()
  await packageButton(page, 'Reload').waitFor({ timeout: UI_TIMEOUT_MS })
  await packageButton(page, 'Reload').click()
  await settingsSave(page).waitFor({ timeout: UI_TIMEOUT_MS })
}

/**
 * Leaves no extension behind for later captures. Settings' Remove asks through a native dialog a
 * hidden capture cannot answer, so this disables the package, deletes its scratch copy, and
 * refreshes discovery.
 */
async function uninstall(page: Page) {
  if (!(await extensionsHeading(page).isVisible())) {
    await openExtensionsSettings(page)
  }
  if (await packageButton(page, 'Disable').isVisible()) {
    // Disabling revokes module access, so a settings frame still importing its modules would
    // log a 404 for each one. Let it finish first.
    await settingsSave(page).waitFor({ timeout: UI_TIMEOUT_MS })
    await packageButton(page, 'Disable').click()
    await packageButton(page, 'Enable').waitFor({ timeout: UI_TIMEOUT_MS })
  }
  // Nothing may still load the package's files once they are gone.
  await page
    .getByRole('region', { name: 'Extension contribution summary' })
    .getByText(/^0\s*Registry contributions/)
    .first()
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await deleteFixtureExtension(await projectPath(page))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await packageCard(page).waitFor({ state: 'detached', timeout: UI_TIMEOUT_MS })
  await backToApp(page)
}

async function withFixtureExtension(page: Page, run: () => Promise<void>) {
  await installAndDiscover(page)
  try {
    await run()
  } finally {
    await uninstall(page)
  }
}

/** One element at the screen's pixel density, so its small text stays readable. */
async function shootElement(context: CaptureContext, element: Locator, file: WebsiteScreenshot) {
  await element.scrollIntoViewIfNeeded()
  await settleForShot(context.page)
  const image = await element.screenshot({ animations: 'disabled', scale: 'device' })
  await writeScreenshot(context, file, image)
}

/** A newly discovered package in Settings > Extensions, waiting for review before Trust. */
export async function captureExtensionReview(context: CaptureContext) {
  const { page } = context
  await withFixtureExtension(page, async () => {
    const untrust = packageButton(page, 'Untrust')
    if (await untrust.isVisible()) await untrust.click()
    await packageButton(page, 'Trust').waitFor({ timeout: UI_TIMEOUT_MS })
    await shootElement(context, packageCard(page), 'extensions-review.png')
  })
}

/**
 * The fixture's settings section, mounted under Extension settings once the package loads. The
 * section's frame has a fixed height and the fixture's form scrolls inside it, so the image ends
 * above the half-hidden Save button.
 */
export async function captureExtensionSettingsSection(context: CaptureContext) {
  const { page } = context
  await withFixtureExtension(page, async () => {
    await loadFixtureExtension(page)
    const region = settingsContributions(page)
    const save = settingsSave(page)
    await save.waitFor({ timeout: UI_TIMEOUT_MS })
    await region.scrollIntoViewIfNeeded()
    await waitForUi(page)
    const section = await regionOf(region)
    const saveTop = (await regionOf(save)).y
    const crop = around(section)
    await shootRegion(context, 'extensions-settings-section.png', {
      ...crop,
      height: saveTop - SAVE_BUTTON_GAP_PX - crop.y,
    })
  })
}

/**
 * Where one extension's surfaces appear around a Session: its side panel, a side panel icon on
 * the Panel rail still marked new, its transcript card, and its status widget.
 */
export async function captureExtensionSurfaces(context: CaptureContext) {
  const { page } = context
  await withFixtureExtension(page, async () => {
    await loadFixtureExtension(page)
    await useFixtureRepository(page)
    await backToApp(page)
    const sidePanel = page.getByRole('complementary').filter({ hasText: 'Extension side panel' })
    const transcriptCard = page
      .locator('[data-chat-content-frame="transcript-extensions"] > *')
      .first()
    const statusWidgets = page.getByRole('region', { name: 'Extension status widgets' })
    await openSession(page, HIVE_QUEEN_TITLE)
    await showRailSurface(page, FIXTURE_EXTENSION_NAME)
    // The side panel reads the issues and stores them; the other surfaces read that store.
    await extensionFrame(sidePanel, FIXTURE_EXTENSION_NAME)
      .getByText(FIRST_ISSUE_TEXT)
      .waitFor({ timeout: UI_TIMEOUT_MS })
    // A round trip through Settings mounts the transcript card and status widget again, now with
    // the stored issues. Switching Sessions alone does not always remount the status widget.
    await openExtensionsSettings(page)
    await backToApp(page)
    await openSession(page, HIVE_QUEEN_TITLE)
    await showRailSurface(page, FIXTURE_EXTENSION_NAME)
    await extensionFrame(transcriptCard, 'GitHub Issues Transcript Summary')
      .getByText(SUMMARY_TEXT)
      .waitFor({ timeout: UI_TIMEOUT_MS })
    await extensionFrame(statusWidgets, 'GitHub Issues Status')
      .getByText(SUMMARY_TEXT)
      .waitFor({ timeout: UI_TIMEOUT_MS })
    await waitForUi(page)
    // The frames grow after they mount, which can leave the transcript short of its end.
    await page.getByRole('log', { name: 'Chat messages' }).evaluate((log) => {
      log.scrollTop = log.scrollHeight
    })
    await waitForUi(page)
    await settleForShot(page)
    // Everything right of the sidebar: the transcript card and status widget in the chat, the
    // side panel, and its icon on the Panel rail.
    const sidebar = await regionOf(page.getByRole('navigation', { name: 'Sidebar' }))
    const view = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    const left = sidebar.x + sidebar.width
    await shootRegion(context, 'extensions-surfaces.png', {
      x: left,
      y: 0,
      width: view.width - left,
      height: view.height,
    })
    await closeRightPanel(page)
  })
}
