import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { SessionId } from '@shared/types/brand'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import sharp from 'sharp'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

const LOCAL_SESSION_TITLE = 'Session Summary local image actions'
const OTHER_SESSION_TITLE = 'Session Summary image action isolation'
const REMOTE_SESSION_TITLE = 'Session Summary remote image retry'
const LOCAL_IMAGE_TITLE = 'local-reference.png'
const REMOTE_IMAGE_TITLE = 'Remote architecture'
const REMOTE_IMAGE_URL = 'https://1.1.1.1/openwaggle-remote-image.png'
const IMAGE_ACTION_TEST_TIMEOUT_MS = 120_000

function imageBytes(background: string) {
  return sharp({
    create: { width: 320, height: 200, channels: 4, background },
  })
    .png()
    .toBuffer()
}

async function openSessionSummary(page: Page) {
  const summary = page.getByRole('complementary', { name: 'Session Summary' })
  if ((await summary.count()) === 0) {
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
  }
  await expect(summary).toBeVisible()
  return summary
}

async function openSourceImage(page: Page, title: string) {
  const summary = await openSessionSummary(page)
  const sources = summary.getByRole('button', { name: /Sources/ })
  if ((await sources.getAttribute('aria-expanded')) !== 'true') await sources.click()
  const image = summary.getByRole('button', { name: title, exact: true })
  await expect(image).toBeVisible({ timeout: 30_000 })
  await image.click()
  const viewer = page.getByRole('dialog', { name: `Image viewer: ${title}` })
  await expect(viewer).toBeVisible()
  return viewer
}

async function sessionImages(page: Page, rawSessionId: string) {
  return page.evaluate(
    (sessionId) =>
      window.api.listSessionResourcePage(sessionId, {
        view: 'images',
        limit: 100,
      }),
    SessionId(rawSessionId),
  )
}

test('image viewer actions cross preload and IPC without escaping the owning session', async () => {
  test.setTimeout(IMAGE_ACTION_TEST_TIMEOUT_MS)
  const app = await OpenWaggleApp.launch('openwaggle-session-image-actions-')

  try {
    const now = Date.now()
    const bytes = await imageBytes('#2563eb')
    const originalPath = path.join(app.userDataDir, LOCAL_IMAGE_TITLE)
    await fs.writeFile(originalPath, bytes)
    const localSessionId = await seedSingleSession(app.userDataDir, {
      title: LOCAL_SESSION_TITLE,
      updatedAt: now,
      messages: [
        {
          id: 'local-image-user-message',
          role: 'user',
          createdAt: now,
          parts: [
            { type: 'text', text: 'Use this local reference.' },
            {
              type: 'attachment',
              attachment: {
                id: 'local-image-attachment',
                kind: 'image',
                origin: 'user-file',
                name: LOCAL_IMAGE_TITLE,
                path: originalPath,
                mimeType: 'image/png',
                sizeBytes: bytes.byteLength,
                contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                extractedText: '',
              },
            },
          ],
        },
      ],
    })
    const otherSessionId = await seedSingleSession(app.userDataDir, {
      title: OTHER_SESSION_TITLE,
      updatedAt: now - 1,
      messages: [
        {
          id: 'other-image-user-message',
          role: 'user',
          createdAt: now - 1,
          parts: [{ type: 'text', text: 'This session must not own the local image.' }],
        },
      ],
    })

    await app.restart()
    await app.resizeMainWindow(1_400, 800)
    await app.installResourceDesktopActionProbe()
    await app.installClipboardImageProbe()

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(LOCAL_SESSION_TITLE)
    const viewer = await openSourceImage(page, LOCAL_IMAGE_TITLE)
    const image = viewer.getByRole('img', { name: LOCAL_IMAGE_TITLE })
    await expect(image).toHaveJSProperty('naturalWidth', 320)
    const imageUrl = await image.getAttribute('src')
    if (!imageUrl) throw new Error('The viewer did not receive an image capability.')
    // Use the unread download URL so Chromium cannot reuse the decoded viewer image.
    const isolatedUrl = imageUrl.replace(/\/view$/u, '/download')
    await page.evaluate((url) => {
      const frame = document.createElement('iframe')
      frame.hidden = true
      frame.dataset.resourceIsolationProbe = 'true'
      frame.setAttribute('sandbox', '')
      frame.srcdoc = `<img src="${url}" alt="Isolated resource probe">`
      document.body.append(frame)
    }, isolatedUrl)
    const frameImage = page.frameLocator('[data-resource-isolation-probe]').locator('img')
    await expect(frameImage).toHaveJSProperty('complete', true)
    await expect(frameImage).toHaveJSProperty('naturalWidth', 0)
    await page.locator('[data-resource-isolation-probe]').evaluate((frame) => frame.remove())
    await app.captureEvidence('session-summary-local-image-actions')

    const downloadedPath = path.join(app.userDataDir, 'downloaded-reference.png')
    await app.captureResourceDownload(downloadedPath)
    await viewer.getByRole('button', { name: 'Download image' }).click()
    await expect.poll(() => app.resourceDownloadResult()).toEqual({
      state: 'completed', fileName: LOCAL_IMAGE_TITLE,
    })
    await expect
      .poll(async () => {
        const metadata = await sharp(downloadedPath).metadata()
        return { width: metadata.width, height: metadata.height }
      })
      .toEqual({ width: 320, height: 200 })

    await viewer.getByRole('button', { name: `Open original ${LOCAL_IMAGE_TITLE}` }).click()
    await viewer.getByRole('button', { name: `Reveal original ${LOCAL_IMAGE_TITLE}` }).click()
    await expect.poll(() => app.resourceDesktopActionProbe()).toEqual({
      openedPath: originalPath,
      revealedPath: originalPath,
    })

    await viewer.getByRole('button', { name: 'Copy image' }).click()
    await expect(page.getByText('Image copied.', { exact: true })).toBeVisible()
    await expect.poll(() => app.clipboardImageProbe()).toEqual({
      empty: false,
      width: 320,
      height: 200,
    })
    await expect(page.getByText('Image copied.', { exact: true })).toHaveCount(0, {
      timeout: 5_000,
    })

    await viewer.getByRole('button', { name: 'Add image to chat' }).click()
    await expect(page.getByText('Image added to chat.', { exact: true })).toBeVisible()
    await viewer.getByRole('button', { name: 'Close image viewer' }).click()
    await expect(page.getByTitle(`Remove ${LOCAL_IMAGE_TITLE}`)).toBeVisible()

    const localCatalog = await sessionImages(page, localSessionId)
    const localResource = localCatalog.resources.find(({ title }) => title === LOCAL_IMAGE_TITLE)
    if (!localResource) throw new Error('The local Session image was not indexed.')
    const crossSessionResult = await page.evaluate(
      async ({ sessionId, resourceId }) => {
        const rejectionMessage = async (operation: Promise<unknown>) => {
          try {
            await operation
            return null
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }
        return {
          copy: await rejectionMessage(
            window.api.copySessionResourceImage(sessionId, resourceId),
          ),
          addToChat: await rejectionMessage(
            window.api.prepareSessionResourceAttachment(sessionId, resourceId),
          ),
        }
      },
      { sessionId: SessionId(otherSessionId), resourceId: localResource.id },
    )
    expect(crossSessionResult.copy).not.toBeNull()
    expect(crossSessionResult.addToChat).not.toBeNull()

    const otherCatalog = await sessionImages(page, otherSessionId)
    expect(otherCatalog.resources).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('remote Markdown images stay lazy, show a materialization error, and retry', async () => {
  test.setTimeout(IMAGE_ACTION_TEST_TIMEOUT_MS)
  const app = await OpenWaggleApp.launch('openwaggle-session-remote-image-')

  try {
    const now = Date.now()
    const bytes = await imageBytes('#16a34a')
    const sessionId = await seedSingleSession(app.userDataDir, {
      title: REMOTE_SESSION_TITLE,
      updatedAt: now,
      messages: [
        {
          id: 'remote-image-assistant-message',
          role: 'assistant',
          createdAt: now,
          parts: [
            {
              type: 'text',
              text: `The agent shared this image. ![${REMOTE_IMAGE_TITLE}](${REMOTE_IMAGE_URL})`,
            },
          ],
        },
      ],
    })

    await app.restart()
    await app.resizeMainWindow(1_400, 800)
    await app.installRemoteImageFetchProbe({
      url: REMOTE_IMAGE_URL,
      dataBase64: bytes.toString('base64'),
      mimeType: 'image/png',
      failuresBeforeSuccess: 1,
    })

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(REMOTE_SESSION_TITLE)
    const summary = await openSessionSummary(page)
    const sources = summary.getByRole('button', { name: /Sources/ })
    if ((await sources.getAttribute('aria-expanded')) !== 'true') await sources.click()
    await expect(
      summary.getByRole('button', { name: REMOTE_IMAGE_TITLE, exact: true }),
    ).toBeVisible({ timeout: 30_000 })
    expect(await app.remoteImageFetchProbe()).toEqual({ count: 0, lastUrl: null })

    const viewer = await openSourceImage(page, REMOTE_IMAGE_TITLE)
    const error = viewer.getByRole('alert')
    await expect(error).toContainText('Couldn’t load this image.')
    await app.captureEvidence('session-summary-remote-image-error')
    await expect.poll(() => app.remoteImageFetchProbe()).toEqual({
      count: 1,
      lastUrl: REMOTE_IMAGE_URL,
    })

    await error.getByRole('button', { name: 'Retry image' }).click()
    await expect(viewer.getByRole('img', { name: REMOTE_IMAGE_TITLE })).toBeVisible()
    await expect(viewer.getByRole('img', { name: REMOTE_IMAGE_TITLE })).toHaveJSProperty(
      'naturalWidth', 320,
    )
    await app.captureEvidence('session-summary-remote-image-retry-success')
    await expect.poll(() => app.remoteImageFetchProbe()).toEqual({
      count: 2,
      lastUrl: REMOTE_IMAGE_URL,
    })

    const catalog = await sessionImages(page, sessionId)
    const remote = catalog.resources.find(({ title }) => title === REMOTE_IMAGE_TITLE)
    expect(remote).toMatchObject({
      kind: 'image',
      locator: REMOTE_IMAGE_URL,
      managed: true,
      available: true,
    })
  } finally {
    await app.cleanup()
  }
})
