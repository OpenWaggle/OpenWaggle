import { expect, type Locator, type Page } from '@playwright/test'

const THREAD_VISIBILITY_TIMEOUT_MS = 12_000
const NEW_THREAD_LABEL = 'New session'
const SCROLL_BOTTOM_TOLERANCE_PX = 8

export class MainWindowPage {
  constructor(readonly page: Page) {}

  async waitUntilReady(): Promise<void> {
    await expect(this.page.getByRole('button', { name: NEW_THREAD_LABEL }).first()).toBeVisible()
  }

  newThreadButton(): Locator {
    return this.page.getByRole('button', { name: NEW_THREAD_LABEL }).first()
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
      const candidate =
        document.querySelector('[aria-label="Message input"][contenteditable]') ??
        document.querySelector('textarea[aria-label="Message input"]')
      if (!candidate) {
        throw new Error('Message input not found')
      }

      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', pastedText)

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
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
    await expect(this.messageInput()).toHaveText(value)
  }

  async expectApproveButtonVisible(): Promise<void> {
    await expect(this.approveButton()).toBeVisible()
  }

  async expectApproveButtonHidden(): Promise<void> {
    await expect(this.approveButton()).toBeHidden()
  }

  lastUserMessage(): Locator {
    return this.page.locator('[data-user-message-id]').last()
  }

  async expectUserMessageAttributeCount(count: number): Promise<void> {
    await expect(this.page.locator('[data-user-message-id]')).toHaveCount(count)
  }

  async expectLastUserMessageVisible(): Promise<void> {
    await expect(this.lastUserMessage()).toBeVisible()
  }

  async expectChatScrollerScrolled(): Promise<void> {
    await expect(async () => {
      const scrollTop = await this.page.evaluate(() => {
        const scroller = document.querySelector('[role="log"]') as HTMLElement | null
        return scroller?.scrollTop ?? 0
      })
      expect(scrollTop).toBeGreaterThan(0)
    }).toPass({ timeout: 3000 })
  }

  /**
   * After sending a message, verify the new user message is near the top of
   * the scroll container. With a plain DOM scroll container (no Virtuoso),
   * the scroll is synchronous — the element should be positioned within
   * ~40px of the container top (PADDING_TOP=20 + small layout gap).
   *
   * scrollTopBefore: the scrollTop before the send, used to confirm scroll changed.
   */
  async expectNewUserMessageScrolledToTop(scrollTopBefore: number): Promise<void> {
    await expect(async () => {
      const result = await this.page.evaluate(
        ({ before }) => {
          const PADDING_TOP = 20
          const TOLERANCE = 40 // allow up to 40px from top (padding + rounding)

          const scroller = document.querySelector('[role="log"]') as HTMLElement | null
          if (!scroller) return { error: 'no scroller' }

          const messages = scroller.querySelectorAll('[data-user-message-id]')
          const el = messages[messages.length - 1] as HTMLElement | null
          if (!el) return { error: 'no user message element' }

          const scrollTop = scroller.scrollTop
          const elTop = el.getBoundingClientRect().top
          const scrollerTop = scroller.getBoundingClientRect().top
          // position of element relative to the scroller's visible top
          const relativeTop = elTop - scrollerTop

          return {
            scrollTop,
            scrollTopBefore: before,
            relativeTop,
            scrollChanged: scrollTop !== before,
            isNearTop: relativeTop >= -4 && relativeTop <= PADDING_TOP + TOLERANCE,
          }
        },
        { before: scrollTopBefore },
      )

      // Must not be an error
      expect('error' in (result ?? {})).toBe(false)
      // scrollTop must have changed (scroll happened)
      expect(result?.scrollChanged).toBe(true)
      // User message must be within ~40px of the scroller top edge
      expect(result?.isNearTop).toBe(true)
    }).toPass({ timeout: 4000 })
  }

  async expectChatScrollerAtBottom(): Promise<void> {
    await expect(async () => {
      const distanceFromBottom = await this.page.evaluate(() => {
        const scroller = document.querySelector('[role="log"]')
        if (!(scroller instanceof HTMLElement)) {
          return null
        }
        return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
      })

      expect(distanceFromBottom).not.toBeNull()
      expect(distanceFromBottom).toBeLessThanOrEqual(SCROLL_BOTTOM_TOLERANCE_PX)
    }).toPass({ timeout: 4000 })
  }

  async expectScrollToBottomButtonHidden(): Promise<void> {
    await expect(async () => {
      const state = await this.page.evaluate(() => {
        const button = document.querySelector('button[aria-label="Scroll to bottom"]')
        const wrapper = button?.parentElement
        if (!(wrapper instanceof HTMLElement)) {
          return { error: 'scroll to bottom wrapper not found' }
        }

        const style = window.getComputedStyle(wrapper)
        return {
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
        }
      })

      expect('error' in state).toBe(false)
      expect(state.opacity).toBe('0')
      expect(state.pointerEvents).toBe('none')
    }).toPass({ timeout: 4000 })
  }
}
