import { execFileSync } from 'node:child_process'
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

async function cycleNativePreview(app: OpenWaggleApp, id: number, url: string, action: 'reload' | 'navigate' | 'crash') {
  return app.electronApplication().evaluate(async ({ webContents }, input) => {
    const contents = webContents.fromId(input.id)
    if (!contents) throw new Error('Native preview disappeared before lifecycle check.')
    const before = await contents.executeJavaScript('({width: innerWidth, height: innerHeight})')
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => {
        contents.removeListener('dom-ready', onReady)
        reject(new Error(`Preview did not recover after ${input.action}.`))
      }, 15_000)
      contents.once('dom-ready', onReady)
      if (input.action === 'reload') contents.reload()
      // forcefullyCrashRenderer may report "killed", which intentionally closes the preview.
      else if (input.action === 'crash') {
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
        void contents.debugger.sendCommand('Page.crash').catch(() => undefined)
      }
      else void contents.loadURL(input.url).catch(reject)
    })
    const after = await contents.executeJavaScript('({width: innerWidth, height: innerHeight})')
    return { before, after }
  }, { id, url, action })
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
      execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
      await fs.writeFile(path.join(projectPath, 'README.md'), 'Summary preview fixture\n')
      execFileSync('git', ['add', 'README.md'], { cwd: projectPath, stdio: 'ignore' })
      execFileSync('git', ['-c', 'user.name=OpenWaggle Tests', '-c', 'user.email=tests@openwaggle.ai', 'commit', '-m', 'test fixture'], { cwd: projectPath, stdio: 'ignore' })
      const sessionIds: string[] = []
      for (const title of ['Summary preview Alpha', 'Summary preview Beta']) {
        sessionIds.push(await seedSingleSession(app.userDataDir, {
          title,
          projectPath,
          updatedAt: Date.now(),
          messages: [{ id: `summary-preview-${sessionIds.length}-message`, role: 'user', createdAt: Date.now(), parts: [{ type: 'text', text: title }] }],
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
      await expect(summary.getByRole('button', { name: 'Branch: main', exact: true })).toBeVisible()
      await expect(summary.getByText('Could not load session resources.')).toHaveCount(0)
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${modifier}+Shift+J`)
      await page.getByRole('textbox', { name: 'Preview address' }).fill(url)
      await page.getByRole('textbox', { name: 'Preview address' }).press('Enter')
      await expect.poll(async () => (await nativePreview(app, url))?.visible).toBe(true)
      const originalNativeId = (await nativePreview(app, url))?.id
      expect(originalNativeId).toBeDefined()
      if (originalNativeId === undefined) throw new Error('Native preview was not created.')
      await page.getByRole('button', { name: 'Float preview over chat' }).click()
      const floating = page.getByRole('region', { name: 'Floating browser preview' })
      await expect(floating).toBeVisible()
      await expect(summary).toHaveCount(0)
      for (const [action, targetUrl] of [
        ['reload', url], ['navigate', `${url}?lifecycle`], ['navigate', url], ['crash', url],
      ] as const) {
        const viewport = await cycleNativePreview(app, originalNativeId, targetUrl, action)
        expect(viewport.after).toEqual(viewport.before)
        await expect.poll(() => nativePreview(app, targetUrl)).toEqual({ id: originalNativeId, visible: true })
      }
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
      await summary.getByRole('button', { name: /Sources/ }).click()
      await summary.getByRole('button', { name: 'Show all', exact: true }).click()
      const resources = page.getByRole('region', { name: 'Session resources' })
      await expect(resources).toBeVisible()
      await expect(resources.getByText('No resources in this view.')).toBeVisible()
      await expect(resources.getByRole('alert')).toHaveCount(0)
      await expect(summary).toHaveCount(0)
      await expect(page.getByTestId('workspace-right-panel')).toBeHidden()
      await expect(floating).toBeHidden()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: false })
      await testInfo.attach('resources-inspector-owns-sidebar', { path: await app.captureEvidence('session-summary-resources-inspector'), contentType: 'image/png' })
      await resources.getByRole('button', { name: 'Close resources' }).click()
      await expect(summary).toBeVisible()
      await expect(floating).toBeHidden()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: false })
      await page.getByRole('button', { name: 'Hide Session Summary', exact: true }).click()
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: true })
      await page.getByRole('button', { name: 'Collapse summary-preview-project' }).hover()
      await page.getByRole('button', { name: 'New session in summary-preview-project' }).click()
      await expect(page.locator('[data-chat-route-session-id]')).toHaveAttribute('data-chat-route-session-id', '')
      await expect(page.getByRole('button', { name: 'Draft session in summary-preview-project' })).toBeVisible()
      await expect(summary).toHaveCount(0)
      const draftUrl = `${url}draft`
      await page.keyboard.press(`${modifier}+Shift+J`)
      await page.getByRole('textbox', { name: 'Preview address' }).fill(draftUrl)
      await page.getByRole('textbox', { name: 'Preview address' }).press('Enter')
      await expect.poll(async () => (await nativePreview(app, draftUrl))?.visible).toBe(true)
      const draftNativeId = (await nativePreview(app, draftUrl))?.id
      expect(draftNativeId).toBeDefined()
      await page.getByRole('button', { name: 'Float preview over chat' }).click()
      await expect(floating).toBeVisible()
      await page.getByRole('button', { name: 'Toggle diff panel' }).click()
      await expect(page.getByRole('button', { name: 'Close diff sidebar' })).toBeVisible()
      await expect(floating).toBeHidden()
      await expect.poll(() => nativePreview(app, draftUrl)).toEqual({ id: draftNativeId, visible: false })
      await expect(page.getByText('No changes to review', { exact: true })).toBeVisible()
      await testInfo.attach('draft-inspector-suspends-native-preview', { path: await app.captureEvidence('draft-inspector-suspends-native-preview'), contentType: 'image/png' })
      await page.getByRole('button', { name: 'Close diff sidebar' }).click()
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, draftUrl)).toEqual({ id: draftNativeId, visible: true })
      await app.mainWindow().openThread('Summary preview Alpha')
      await expect.poll(async () => (await nativePreview(app, draftUrl))?.visible).not.toBe(true)
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: true })
      // The draft row is shown only while that draft is active; the project action returns to it.
      await page.getByRole('button', { name: 'Collapse summary-preview-project' }).hover()
      await page.getByRole('button', { name: 'New session in summary-preview-project' }).click()
      await expect(page.locator('[data-chat-route-session-id]')).toHaveAttribute('data-chat-route-session-id', '')
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, draftUrl)).toEqual({ id: draftNativeId, visible: true })
      await expect.poll(async () => (await nativePreview(app, url))?.visible).not.toBe(true)
      await testInfo.attach('draft-preview-restored-after-session-navigation', { path: await app.captureEvidence('draft-preview-restored-after-session-navigation'), contentType: 'image/png' })
      // Main-page screenshots omit native child layers; capture the actual preview pixels separately.
      const nativeEvidence = await app.electronApplication().evaluate(async ({ webContents }, id) => {
        const contents = id === undefined ? undefined : webContents.fromId(id)
        if (!contents) throw new Error('Restored draft native preview is missing.')
        const body = await contents.executeJavaScript('document.body.innerText')
        const screenshot = await contents.capturePage()
        if (screenshot.isEmpty()) throw new Error('Native preview screenshot is empty.')
        return { body, png: screenshot.toPNG().toString('base64') }
      }, draftNativeId)
      expect(nativeEvidence.body).toContain('Native preview fixture')
      await testInfo.attach('restored-draft-native-preview-pixels', { body: Buffer.from(nativeEvidence.png, 'base64'), contentType: 'image/png' })
      // Floating X hides the overlay; the panel tab's Close action disposes the actual browser.
      await floating.getByRole('button', { name: 'Open preview in right panel' }).click()
      await expect(floating).toHaveCount(0)
      const closePreview = page.getByRole('button', { name: 'Close Summary native preview fixture', exact: true })
      await expect(closePreview).toBeVisible()
      await app.electronApplication().evaluate(({ webContents }, id) => {
        const contents = id === undefined ? undefined : webContents.fromId(id)
        if (!contents) throw new Error('Draft preview is missing before close rejection probe.')
        const originalClose = contents.close
        contents.close = () => {
          contents.close = originalClose
          throw new Error('Native close rejection fixture')
        }
      }, draftNativeId)
      await closePreview.click()
      await expect(page.getByText(/Native close rejection fixture/u)).toBeVisible()
      await expect(closePreview).toBeVisible()
      await expect.poll(() => nativePreview(app, draftUrl)).toEqual({ id: draftNativeId, visible: true })
      await expect(page.getByText(/CONTENT_CLOSED|Page could not load/u)).toHaveCount(0)
      await testInfo.attach('native-close-rejection-retains-tab', { path: await app.captureEvidence('native-close-rejection-retains-tab'), contentType: 'image/png' })
      await closePreview.click()
      await expect(closePreview).toHaveCount(0)
      await expect.poll(() => app.electronApplication().evaluate(({ webContents }, id) => {
        const contents = id === undefined ? undefined : webContents.fromId(id)
        return contents === undefined || contents.isDestroyed()
      }, draftNativeId)).toBe(true)
      await expect(page.getByText(/CONTENT_CLOSED|Page could not load/u)).toHaveCount(0)
      await app.mainWindow().openThread('Summary preview Alpha')
      await expect(floating).toBeVisible()
      await expect.poll(() => nativePreview(app, url)).toEqual({ id: originalNativeId, visible: true })
      await testInfo.attach('native-close-retry-preserves-other-session', { path: await app.captureEvidence('native-close-retry-preserves-other-session'), contentType: 'image/png' })
      const alphaPreviewId = await floating.getAttribute('data-browser-preview-floating')
      if (!alphaPreviewId) throw new Error('Alpha preview identity is missing before quarantine probe.')
      await floating.getByRole('button', { name: 'Open preview in right panel' }).click()
      const quarantineProbe = await app.electronApplication().evaluateHandle(({ BrowserWindow, WebContentsView }, id) => {
        for (const owner of BrowserWindow.getAllWindows()) {
          for (const view of owner.contentView.children) {
            if (!(view instanceof WebContentsView) || view.webContents.id !== id) continue
            const contents = view.webContents
            const originalClose = contents.close
            contents.close = () => { throw new Error('Persistent native close rejection fixture') }
            return { owner, view, contents, originalClose }
          }
        }
        throw new Error('Alpha native view is missing before quarantine probe.')
      }, originalNativeId)
      try {
        await closePreview.click()
        await expect(page.getByText(/Persistent native close rejection fixture/u)).toBeVisible()
        await quarantineProbe.evaluate(({ owner }) => {
          // Exercise trust-loss listeners without navigating or launching any external page.
          owner.webContents.emit('did-start-navigation', {
            isMainFrame: true, isSameDocument: false, url: 'https://untrusted.invalid/',
          })
        })
        await expect.poll(() => quarantineProbe.evaluate(({ owner, view, contents }) => ({
          live: !contents.isDestroyed(),
          visible: view.getVisible(),
          attached: owner.contentView.children.includes(view),
        }))).toEqual({ live: true, visible: false, attached: false })
        for (const action of ['capture', 'reload'] as const) {
          const result = await page.evaluate(async ({ id, action }) => {
            try {
              if (action === 'capture') await window.api.captureBrowserPreviewScreenshot(id)
              else await window.api.reloadBrowserPreview(id)
              return { rejected: false, message: '' }
            } catch (error) {
              return { rejected: true, message: error instanceof Error ? error.message : String(error) }
            }
          }, { id: alphaPreviewId, action })
          expect(result).toEqual({ rejected: true, message: expect.stringMatching(/\S/u) })
        }
        await testInfo.attach('native-quarantine-denies-retained-preview', { path: await app.captureEvidence('native-quarantine-denies-retained-preview'), contentType: 'image/png' })
        await quarantineProbe.evaluate(({ contents, originalClose }) => { contents.close = originalClose })
        await closePreview.click()
        await expect(closePreview).toHaveCount(0)
        await expect.poll(() => quarantineProbe.evaluate(({ contents }) => contents.isDestroyed())).toBe(true)
        await testInfo.attach('native-quarantine-close-retry', { path: await app.captureEvidence('native-quarantine-close-retry'), contentType: 'image/png' })
      } finally {
        await quarantineProbe.evaluate(({ contents, originalClose }) => {
          if (!contents.isDestroyed()) contents.close = originalClose
        }).catch(() => undefined)
        await quarantineProbe.dispose()
      }
      expect(errors).toEqual([])
      expect(await app.desktopState()).toMatchObject({ focused: false, visible: false })
    } finally {
      await app.cleanup()
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
