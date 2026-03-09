import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'

const LONG_PROMPT_SENTINEL = 'AUTO_ATTACH_SENTINEL_LONG_PROMPT_MUST_NOT_RENDER_INLINE'
const LONG_PROMPT_TEXT = `${LONG_PROMPT_SENTINEL}\n${'x'.repeat(400_000)}`
const SHORT_PROMPT_TEXT = 'hello'
const LONG_PROMPT_TOAST = 'Long prompt auto-converted to file attachment.'
const AUTO_ATTACHMENT_LABEL = 'Pasted Text 1.md'

test('long prompt auto-converts to attachment and clears the composer', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-auto-attach-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.createNewThread()
    await mainWindow.pasteIntoComposer(LONG_PROMPT_TEXT)

    await expect(mainWindow.progressBar()).toBeVisible()
    await expect(mainWindow.progressBar()).toHaveAttribute('aria-valuenow', '100')
    await mainWindow.expectTextVisible(LONG_PROMPT_TOAST)
    await mainWindow.expectAttachmentCount(AUTO_ATTACHMENT_LABEL, 1)
    await mainWindow.expectComposerValue('')

    await mainWindow.submitComposer()
    await mainWindow.expectAttachmentVisible(AUTO_ATTACHMENT_LABEL)
    await mainWindow.expectTextHidden(LONG_PROMPT_SENTINEL)
  } finally {
    await app.cleanup()
  }
})

test('short paste does not auto-convert to attachment', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-auto-attach-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.createNewThread()
    await mainWindow.pasteIntoComposer(SHORT_PROMPT_TEXT)

    await mainWindow.expectTextHidden(LONG_PROMPT_TOAST)
    await mainWindow.expectTextHidden(AUTO_ATTACHMENT_LABEL)
  } finally {
    await app.cleanup()
  }
})
