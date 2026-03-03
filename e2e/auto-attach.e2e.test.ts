import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const LONG_PROMPT_SENTINEL = 'AUTO_ATTACH_SENTINEL_LONG_PROMPT_MUST_NOT_RENDER_INLINE'
const LONG_PROMPT_TEXT = `${LONG_PROMPT_SENTINEL}\n${'x'.repeat(400_000)}`
const SHORT_PROMPT_TEXT = 'hello'
const LONG_PROMPT_TOAST = 'Long prompt auto-converted to file attachment.'
const AUTO_ATTACHMENT_LABEL = 'Pasted Text 1.md'

async function dispatchSyntheticPaste(window: Page, text: string): Promise<void> {
  await window.evaluate((pastedText) => {
    const textarea = document.querySelector(
      'textarea[aria-label="Message input"]',
    ) as HTMLTextAreaElement | null
    if (!textarea) throw new Error('Message input not found')
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (kind: string) => (kind === 'text' ? pastedText : ''),
      },
    })
    textarea.dispatchEvent(pasteEvent)
  }, text)
}

async function launchWithUserData(userDataDir: string) {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OPENWAGGLE_USER_DATA_DIR: userDataDir,
    },
  })
}

test('long prompt auto-converts to attachment and clears the composer', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-auto-attach-'))
  const app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()
    await window.getByRole('button', { name: 'New thread' }).first().click()

    const messageInput = window.getByRole('textbox', { name: 'Message input' })
    await messageInput.click()
    await dispatchSyntheticPaste(window, LONG_PROMPT_TEXT)

    const progressBar = window.getByRole('progressbar').first()
    await expect(progressBar).toBeVisible()
    await expect(progressBar).toHaveAttribute('aria-valuenow', '100')
    await expect(window.getByText(LONG_PROMPT_TOAST)).toBeVisible()
    await expect(window.getByText(AUTO_ATTACHMENT_LABEL)).toHaveCount(1)
    await expect(messageInput).toHaveValue('')

    await messageInput.press('Enter')
    await expect(window.getByText('[Attachment] Pasted Text 1.md')).toBeVisible()
    await expect(window.getByText(LONG_PROMPT_SENTINEL)).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('short paste does not auto-convert to attachment', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-auto-attach-'))
  const app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()
    await window.getByRole('button', { name: 'New thread' }).first().click()

    const messageInput = window.getByRole('textbox', { name: 'Message input' })
    await messageInput.click()
    await dispatchSyntheticPaste(window, SHORT_PROMPT_TEXT)

    await expect(window.getByText(LONG_PROMPT_TOAST)).toBeHidden()
    await expect(window.getByText(AUTO_ATTACHMENT_LABEL)).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
