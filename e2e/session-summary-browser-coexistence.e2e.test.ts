import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

async function nativePreview(app: OpenWaggleApp, url: string) {
  return app.electronApplication().evaluate(({ BrowserWindow, WebContentsView }, expectedUrl) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const child of window.contentView.children) {
        if (child instanceof WebContentsView && child.webContents.getURL() === expectedUrl) {
          return { id: child.webContents.id, visible: child.getVisible() }
        }
      }
    }
    return null
  }, url)
}

test('Session Summary coordinates native floating previews and inspectors across sessions', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Summary native preview fixture</title><h1>Native preview fixture</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Preview fixture did not bind a port.')
    const url = `http://127.0.0.1:${address.port}/`
    const app = await OpenWaggleApp.launch('openwaggle-summary-preview-')
    try {
      const projectPath = path.join(app.userDataDir, 'summary-preview-project')
      await fs.mkdir(projectPath, { recursive: true })
      const sessionIds: string[] = []
      for (const title of ['Summary preview Alpha', 'Summary preview Beta']) {
        sessionIds.push(await seedSingleSession(app.userDataDir, {
          title,
          projectPath,
          messages: [{ id: `${title}-message`, role: 'user', createdAt: Date.now(), parts: [{ type: 'text', text: title }] }],
        }))
      }
      const [alpha, beta] = sessionIds
      if (!alpha || !beta) throw new Error('Session fixtures are missing.')
      await app.restart()
      await app.resizeMainWindow(1900, 1100)
      const page = app.window()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.evaluate((id) => { location.hash = `/sessions/${id}` }, alpha)
      const summary = page.getByRole('complementary', { name: 'Session Summary' })
      await expect(summary).toBeVisible()
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${modifier}+Shift+J`)
      await page.getByRole('textbox', { name: 'Preview address' }).fill(url)
      await page.getByRole('textbox', { name: 'Preview address' }).press('Enter')
      await expect.poll(async () => (await nativePreview(app, url))?.visible).toBe(true)
      const originalNativeId = (await nativePreview(app, url))?.id
      expect(originalNativeId).toBeDefined()
      await page.getByRole('button', { name: 'Float preview over chat' }).click()
      const floating = page.getByRole('region', { name: 'Floating browser preview' })
      await expect(floating).toBeVisible()
      await expect(summary).toHaveCount(0)
      await page.getByRole('button', { name: 'Open Session Summary', exact: true }).click()
      await expect(summary).toBeVisible()
      await expect(floating).toBeHidden()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: false })
      await testInfo.attach('manual-summary-suspends-native-preview', { path: await app.captureEvidence('session-summary-manual-native-preview'), contentType: 'image/png' })

      await page.evaluate((id) => { location.hash = `/sessions/${id}` }, beta)
      await expect(page.locator('[data-chat-route-session-id]')).toHaveAttribute('data-chat-route-session-id', beta)
      await expect(page.locator('[data-browser-preview-floating]')).toHaveCount(0)
      await expect(summary).toBeVisible()
      await expect.poll(async () => (await nativePreview(app, url))?.visible).not.toBe(true)
      await testInfo.attach('other-session-has-no-preview-leak', { path: await app.captureEvidence('session-summary-other-session-no-preview'), contentType: 'image/png' })

      await page.evaluate((id) => { location.hash = `/sessions/${id}` }, alpha)
      await expect(summary).toBeVisible()
      await page.getByRole('button', { name: 'Hide Session Summary', exact: true }).click()
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: true })
      await page.getByRole('button', { name: 'Open Session Summary', exact: true }).click()
      await summary.getByRole('button', { name: 'Show all', exact: true }).last().click()
      await expect(page.getByRole('region', { name: 'Session resources' })).toBeVisible()
      await expect(summary).toHaveCount(0)
      await expect(page.getByTestId('workspace-right-panel')).toBeHidden()
      await testInfo.attach('resources-inspector-owns-sidebar', { path: await app.captureEvidence('session-summary-resources-inspector'), contentType: 'image/png' })
      expect(errors).toEqual([])
      expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
    } finally {
      await app.cleanup()
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
