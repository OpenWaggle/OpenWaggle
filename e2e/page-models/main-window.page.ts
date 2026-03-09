import { expect, type Locator, type Page } from '@playwright/test'

const READY_COPY = "Let's build"
const THREAD_VISIBILITY_TIMEOUT_MS = 12_000

export class MainWindowPage {
  constructor(readonly page: Page) {}

  async waitUntilReady(): Promise<void> {
    await expect(this.page.getByText(READY_COPY)).toBeVisible()
  }

  newThreadButton(): Locator {
    return this.page.getByRole('button', { name: 'New thread' }).first()
  }

  messageInput(): Locator {
    return this.page.getByRole('textbox', { name: 'Message input' })
  }

  progressBar(): Locator {
    return this.page.getByRole('progressbar').first()
  }

  threadItem(title: string): Locator {
    return this.page.getByText(title).first()
  }

  approveButton(): Locator {
    return this.page.getByRole('button', { name: 'Approve' })
  }

  text(text: string): Locator {
    return this.page.getByText(text)
  }

  attachmentLabel(name: string): Locator {
    return this.page.getByText(name)
  }

  async createNewThread(): Promise<void> {
    await this.newThreadButton().click()
  }

  async openThread(title: string): Promise<void> {
    const thread = this.threadItem(title)
    await expect(thread).toBeVisible({ timeout: THREAD_VISIBILITY_TIMEOUT_MS })
    await thread.click()
  }

  async pasteIntoComposer(text: string): Promise<void> {
    await this.messageInput().click()
    await this.page.evaluate((pastedText) => {
      const candidate = document.querySelector('textarea[aria-label="Message input"]')
      if (!(candidate instanceof HTMLTextAreaElement)) {
        throw new Error('Message input not found')
      }

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: (kind: string) => (kind === 'text' ? pastedText : ''),
        },
      })
      candidate.dispatchEvent(pasteEvent)
    }, text)
  }

  async submitComposer(): Promise<void> {
    await this.messageInput().press('Enter')
  }

  async expectTextVisible(text: string): Promise<void> {
    await expect(this.text(text)).toBeVisible()
  }

  async expectTextHidden(text: string): Promise<void> {
    await expect(this.text(text)).toBeHidden()
  }

  async expectAttachmentVisible(name: string): Promise<void> {
    await expect(this.attachmentLabel(name).first()).toBeVisible()
  }

  async expectAttachmentCount(name: string, count: number): Promise<void> {
    await expect(this.attachmentLabel(name)).toHaveCount(count)
  }

  async expectComposerValue(value: string): Promise<void> {
    await expect(this.messageInput()).toHaveValue(value)
  }

  async expectApproveButtonVisible(): Promise<void> {
    await expect(this.approveButton()).toBeVisible()
  }

  async expectApproveButtonHidden(): Promise<void> {
    await expect(this.approveButton()).toBeHidden()
  }
}
