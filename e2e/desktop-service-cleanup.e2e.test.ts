import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { SessionId } from '../src/shared/types/brand'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Host-owned native cleanup fixture'
const SHELL_TIMEOUT_MS = 20_000

async function shellPid(page: Page, marker: string) {
  const pane = page.locator('[data-terminal-pane]')
  await expect(pane).toHaveCount(1)
  await expect(pane).toHaveAttribute('data-readiness', 'ready', { timeout: SHELL_TIMEOUT_MS })
  await pane.click()
  await expect(pane.locator('textarea.xterm-helper-textarea')).toBeFocused()
  // Encode the separators so command echo cannot satisfy the output assertion.
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${marker}' + '_' + $PID + '_END')`
      : `printf '${marker}\\137%s\\137END\\n' "$$"`
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  const output = pane.locator('.xterm-rows')
  const pattern = new RegExp(`${marker}_(\\d+)_END`)
  await expect(output).toContainText(pattern, { timeout: SHELL_TIMEOUT_MS })
  const match = pattern.exec((await output.textContent()) ?? '')
  if (!match?.[1]) throw new Error('The real shell did not report its process identity.')
  const pid = Number(match[1])
  expect(pid).toBeGreaterThan(0)
  return pid
}

async function processExists(app: OpenWaggleApp, pid: number) {
  return app.electronApplication().evaluate((_electron, processId) => {
    try {
      process.kill(processId, 0)
      return true
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
      throw error
    }
  }, pid)
}

test('Host archive closes exact native resources and an unarchived Session can open a fresh terminal', async () => {
  test.setTimeout(120_000)
  const app = await OpenWaggleApp.launch('openwaggle-desktop-cleanup-e2e-', {
    isolatedPiAgent: true,
  })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', connection: 'close' })
    response.end('<title>Native cleanup fixture</title><p>Owned by this Session.</p>')
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing fixture port.')
    const url = `http://127.0.0.1:${address.port}/native-cleanup-fixture`
    const projectPath = path.join(app.userDataDir, 'native-cleanup-project')
    await fs.mkdir(projectPath, { recursive: true })
    const sessionId = SessionId(
      await seedSingleSession(app.userDataDir, {
        title: SESSION_TITLE,
        projectPath,
        updatedAt: Date.now(),
        messages: [
          {
            id: 'native-cleanup-message',
            role: 'user',
            createdAt: Date.now(),
            parts: [
              {
                type: 'text',
                text: 'Verify native terminal and browser cleanup through the Session Host.',
              },
            ],
          },
        ],
      }),
    )
    await app.restart()
    const page = app.window()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await app.mainWindow().waitUntilReady()
    await app.mainWindow().openThread(SESSION_TITLE)
    expect(
      await page.evaluate(() => ({
        hasApi: typeof window.api.archiveSession === 'function',
        electron: navigator.userAgent.includes('Electron'),
      })),
    ).toEqual({ hasApi: true, electron: true })
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
    const originalPid = await shellPid(page, 'HIVE_ORIGINAL')
    expect(await processExists(app, originalPid)).toBe(true)

    await page.evaluate(
      async ({ ownerKey, url }) => {
        // The selected Session must already own a real browser binding; do not repair it in the test.
        await window.api.setCurrentBrowserPreview(ownerKey, null)
        await window.api.openBrowserPreview({
          ownerKey,
          previewId: 'cleanup-browser',
          profileId: 'incognito',
          url,
          visible: false,
          bounds: { x: 0, y: 0, width: 640, height: 480 },
        })
      },
      { ownerKey: sessionId, url },
    )
    const findBrowserId = () =>
      app
        .electronApplication()
        .evaluate(
          ({ webContents }, targetUrl) =>
            webContents.getAllWebContents().find((contents) => contents.getURL() === targetUrl)
              ?.id ?? null,
          url,
        )
    await expect.poll(findBrowserId).not.toBeNull()
    const browserId = await findBrowserId()
    if (browserId === null) throw new Error('The native fixture browser was not created.')
    await app.captureEvidence('desktop-cleanup-live-terminal')

    // Detach the pane first: hiding must preserve the PTY, and renderer teardown must not
    // be able to masquerade as the Host's acknowledged cleanup operation.
    await page.getByRole('button', { name: 'Close terminal panel', exact: true }).click()
    expect(await processExists(app, originalPid)).toBe(true)
    expect(
      (await page.evaluate(() => window.api.getTerminalActivitySnapshot())).summaries.some(
        (entry) => entry.ownerKey === sessionId,
      ),
    ).toBe(true)
    await page.evaluate((id) => window.api.archiveSession(id), sessionId)
    expect(await page.evaluate((id) => window.api.getSessionDetail(id), sessionId)).toMatchObject({
      archived: true,
    })
    expect(await processExists(app, originalPid)).toBe(false)
    expect(
      await app
        .electronApplication()
        .evaluate(
          ({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true,
          browserId,
        ),
    ).toBe(true)
    expect(
      (await page.evaluate(() => window.api.getTerminalActivitySnapshot())).summaries.filter(
        (entry) => entry.ownerKey === sessionId,
      ),
    ).toEqual([])

    await page.evaluate((id) => window.api.unarchiveSession(id), sessionId)
    await app.mainWindow().openThread(SESSION_TITLE)
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
    const reopenedPid = await shellPid(page, 'HIVE_REOPENED')
    expect(await processExists(app, reopenedPid)).toBe(true)
    expect(await page.evaluate((id) => window.api.getSessionDetail(id), sessionId)).toMatchObject({
      archived: false,
    })
    await app.captureEvidence('desktop-cleanup-reopened-terminal')
    expect(errors).toEqual([])
    expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
  } finally {
    try {
      await app.cleanup()
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    }
  }
})
