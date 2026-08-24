import { chromium } from '@playwright/test'

const SETTLE_MS = 1200
const RENDER_MS = 1500
const JSON_INDENT = 2

/**
 * Electron QA over CDP.
 *
 * Connects to the running dev app on port 9222 rather than launching a browser, so the assertions
 * run against the real renderer with a live preload bridge. Reports console errors, because a
 * surface that renders but throws is not working.
 */
async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  if (!context) throw new Error('No Electron browser context on 9222')
  const page = context.pages()[0]
  if (!page) throw new Error('No Electron page on 9222')

  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  const results: Record<string, unknown> = {}

  results.preloadBridge = await page.evaluate(
    () => typeof window.api === 'object' && window.api !== null,
  )
  results.grantApiPresent = await page.evaluate(() => ({
    list: typeof window.api?.listAuthorizationGrants === 'function',
    grant: typeof window.api?.grantAuthorization === 'function',
    revoke: typeof window.api?.revokeAuthorization === 'function',
    setSessionMode: typeof window.api?.setSessionAuthorizationMode === 'function',
  }))

  results.defaultMode = await page.evaluate(async () => {
    const settings = await window.api?.getSettings()
    return settings?.defaultAuthorizationMode
  })

  // Settings: the access-mode selects and the saved-approval card.
  // Reached the way a user reaches it, by clicking Settings in the sidebar.
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(SETTLE_MS)
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.waitForTimeout(RENDER_MS)
  results.settingsUrl = page.url()
  results.settingsHeading = await page.getByText('Agent access').count()
  await page.screenshot({ path: 'out/qa-agent-access-settings.png' })

  results.settings = {
    defaultModeSelect: await page.locator('select[aria-label="Default access mode"]').count(),
    defaultModeValue: await page
      .locator('select[aria-label="Default access mode"]')
      .inputValue()
      .catch(() => null),
    projectModeSelect: await page
      .locator('select[aria-label="Current project access mode"]')
      .count(),
    useDefaultOption: await page
      .locator('select[aria-label="Current project access mode"] option[value="inherit"]')
      .count(),
    modeLabels: await page.locator('select[aria-label="Default access mode"] option').allInnerTexts(),
    savedApprovalsHeading: await page.getByText('Saved approvals').count(),
    revocationCopy: await page
      .getByText('Revoking stops future use. It does not recall work already done.')
      .count(),
  }

  results.shortcutRegistered = await page.evaluate(async () => {
    const settings = await window.api?.getSettings()
    return settings?.shortcutBindings?.['request.focus']
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(SETTLE_MS)
  results.chatRoute = {
    composerPresent: await page.locator('[data-chat-composer-form="true"]').count(),
    noRibbonWhenNothingPending: await page.locator('[data-request-ribbon="true"]').count(),
    noNotificationStack: await page.getByLabel('Agent notifications').count(),
  }

  results.consoleErrors = consoleErrors.filter(
    (text) => !text.includes('Download the React DevTools'),
  )

  console.log(JSON.stringify(results, null, JSON_INDENT))
  await browser.close()
}

void main()
