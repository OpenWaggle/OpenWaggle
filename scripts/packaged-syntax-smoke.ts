import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchOpenWaggleElectron } from './playwright-electron-launcher'

const STARTUP_TIMEOUT_MS = 30_000
const USER_ARGUMENT_OFFSET = 2
const PACKAGED_SCREENSHOT_PATH = path.join(os.tmpdir(), 'openwaggle-packaged-syntax-smoke.png')
const SYNTAX_RUNTIME_PATTERN = /monaco|shiki|syntax|worker/i

function packagedExecutablePath() {
  const executablePath = process.argv
    .slice(USER_ARGUMENT_OFFSET)
    .find((argument) => argument !== '--')
  if (!executablePath) {
    throw new Error('Pass the packaged OpenWaggle executable path to packaged-syntax:smoke.')
  }
  return path.resolve(executablePath)
}

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-packaged-syntax-'))
  const rendererIssues: string[] = []
  const app = await launchOpenWaggleElectron({
    executablePath: packagedExecutablePath(),
    hidden: true,
    userDataDir,
  })

  try {
    const page = await app.firstWindow()
    page.on('console', (message) => {
      const isSyntaxWarning =
        message.type() === 'warning' && SYNTAX_RUNTIME_PATTERN.test(message.text())
      if (message.type() === 'error' || isSyntaxWarning) {
        rendererIssues.push(`console:${message.type()}:${message.text()}`)
      }
    })
    page.on('pageerror', (error) => rendererIssues.push(`pageerror:${error.message}`))

    await page.locator('#root').waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS })
    const apiAvailable = await page.evaluate(() => Reflect.has(window, 'api'))
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()
    await page
      .getByRole('heading', { name: 'Syntax theme' })
      .waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS })
    const previewLanguage = page.getByRole('combobox', { name: 'Preview language' })
    await page
      .locator(
        '[aria-label="TypeScript syntax theme preview"][data-syntax-status="highlighted"]',
      )
      .waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS })
    await previewLanguage.selectOption('json')
    await page
      .locator('[aria-label="JSON syntax theme preview"][data-syntax-status="highlighted"]')
      .waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS })

    const legacyEditorResources = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((resource) => /monaco|ts\.worker/iu.test(resource)),
    )

    await page.screenshot({ path: PACKAGED_SCREENSHOT_PATH, fullPage: true })

    if (!apiAvailable) {
      throw new Error('The packaged preload bridge did not expose window.api.')
    }
    if (legacyEditorResources.length > 0) {
      throw new Error(`Legacy editor resources loaded: ${legacyEditorResources.join(', ')}`)
    }
    if (rendererIssues.length > 0) {
      throw new Error(`Packaged syntax renderer issues: ${rendererIssues.join(' | ')}`)
    }

    console.log(
      `packaged syntax smoke passed: review-first TypeScript and JSON; screenshot ${PACKAGED_SCREENSHOT_PATH}`,
    )
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
