import { createServer } from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type Browser, chromium, type Page } from '@playwright/test'
import { AUTOMATION_IDENTITY_QUERY_PARAM } from '../../src/shared/constants/electron-automation'

const CDP_RETRY_DELAY_MS = 250

export class LiveQaCdpIdentityError extends Error {}

export function assertLiveQaPageAutomationIdentity(url: string, automationIdentity: string) {
  const actualIdentity = new URL(url).searchParams.get(AUTOMATION_IDENTITY_QUERY_PARAM)
  if (actualIdentity !== automationIdentity) {
    throw new LiveQaCdpIdentityError(
      'Packaged QA connected to an OpenWaggle renderer with a different automation identity.',
    )
  }
}

export async function reserveDebugPort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    server.close()
    throw new Error('Could not reserve an Electron debugging port.')
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return address.port
}

async function connectToElectron(debugPort: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${String(debugPort)}`)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, CDP_RETRY_DELAY_MS))
    }
  }
  throw new Error(`Could not connect to packaged Electron over CDP: ${String(lastError)}`)
}

async function waitForRendererPage(
  browser: Browser,
  timeoutMs: number,
  automationIdentity: string,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith('openwaggle://'))
    if (page) {
      assertLiveQaPageAutomationIdentity(page.url(), automationIdentity)
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, CDP_RETRY_DELAY_MS))
  }
  throw new Error('Packaged Electron did not expose its renderer page.')
}

export async function waitForLiveGui(
  debugPort: number,
  timeoutMs: number,
  automationIdentity: string,
) {
  const browser = await connectToElectron(debugPort, timeoutMs)
  try {
    const page = await waitForRendererPage(browser, timeoutMs, automationIdentity)
    await page.locator('body').waitFor({ state: 'visible', timeout: timeoutMs })
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export async function verifyLiveHiveGui(input: {
  readonly debugPort: number
  readonly queenTitle: string
  readonly timeoutMs: number
  readonly automationIdentity: string
}) {
  const browser = await connectToElectron(input.debugPort, input.timeoutMs)
  try {
    const page = await waitForRendererPage(
      browser,
      input.timeoutMs,
      input.automationIdentity,
    )
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => consoleErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    const runtime = await page.evaluate(() => ({
      hasApi: 'api' in window,
      isElectron: navigator.userAgent.includes('Electron'),
    }))
    if (!runtime.hasApi || !runtime.isElectron) {
      throw new Error('Live Hive QA requires the real Electron renderer and preload API.')
    }
    const row = (title: string) =>
      page.locator('[data-qa="sidebar-session-row"]').filter({ hasText: title })
    const queenRow = row(input.queenTitle)
    await queenRow.waitFor({ state: 'visible', timeout: input.timeoutMs })
    const queenLineage = queenRow.locator('[data-qa="sidebar-session-lineage"]')
    await queenLineage.waitFor({ state: 'visible', timeout: input.timeoutMs })
    const queenTitle = await queenLineage.getAttribute('title')
    if (!queenTitle?.startsWith('Queen Session · 1 direct Worker')) {
      throw new Error(`GUI Queen lineage was not projected: ${String(queenTitle)}`)
    }
    const workerLineage = page.locator(
      '[data-qa="sidebar-session-lineage"][title^="Worker Session · Parent:"]',
    )
    if ((await workerLineage.count()) !== 1) {
      throw new Error('GUI did not project exactly one Worker Session in the sidebar.')
    }

    await queenRow.click()
    const hive = page.getByRole('region', { name: 'Hive Sessions' })
    await hive.waitFor({ state: 'visible', timeout: input.timeoutMs })
    const workerShortcut = hive.getByRole('button', { name: /^Open Worker Session:/ })
    await workerShortcut.waitFor({ state: 'visible', timeout: input.timeoutMs })
    await hive.getByRole('button', { name: 'Collapse Hive Sessions', exact: true }).click()
    await workerShortcut.waitFor({ state: 'hidden', timeout: input.timeoutMs })
    await hive.getByRole('button', { name: 'Expand Hive Sessions', exact: true }).click()
    await workerShortcut.waitFor({ state: 'visible', timeout: input.timeoutMs })
    await workerShortcut.click()
    await page.locator('header').getByText('Worker', { exact: true }).waitFor({
      state: 'visible',
      timeout: input.timeoutMs,
    })
    await hive.getByRole('button', { name: /^Open parent Session:/ }).waitFor({
      state: 'visible',
      timeout: input.timeoutMs,
    })

    const evidenceDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'openwaggle-live-hive-evidence-'),
    )
    const screenshotPath = path.join(evidenceDirectory, 'live-queen-worker-hive.png')
    await page.screenshot({ path: screenshotPath })
    await hive.getByRole('button', { name: /^Open parent Session:/ }).click()
    await page.locator('header').getByText('Queen', { exact: true }).waitFor({
      state: 'visible',
      timeout: input.timeoutMs,
    })
    if (consoleErrors.length > 0) {
      throw new Error(`Live Hive renderer errors (${screenshotPath}): ${consoleErrors.join('\n')}`)
    }
    return screenshotPath
  } finally {
    await browser.close().catch(() => undefined)
  }
}
