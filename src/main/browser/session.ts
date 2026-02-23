import type { Browser, BrowserContext, Page } from 'playwright'
import { createLogger } from '../logger'

const logger = createLogger('browser')

const MAX_SCREENSHOT_WIDTH = 1280

export interface NavigationResult {
  readonly title: string
  readonly url: string
  readonly status: number | null
}

export interface ScreenshotResult {
  readonly base64Image: string
  readonly mimeType: string
  readonly pageTitle: string
  readonly url: string
}

export class BrowserSession {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  async ensureBrowser(headless: boolean): Promise<void> {
    if (this.browser) return

    // Dynamic import — playwright is externalized (native binary)
    const { chromium } = await import('playwright')
    logger.info('launching browser', { headless })
    this.browser = await chromium.launch({ headless })
    this.context = await this.browser.newContext({
      viewport: { width: MAX_SCREENSHOT_WIDTH, height: 800 },
    })
    this.page = await this.context.newPage()
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
  ): Promise<NavigationResult> {
    const page = this.requirePage()
    logger.info('navigating', { url, waitUntil })
    const response = await page.goto(url, { waitUntil })
    const title = await page.title()
    return {
      title,
      url: page.url(),
      status: response?.status() ?? null,
    }
  }

  async click(selector: string): Promise<void> {
    const page = this.requirePage()
    logger.info('clicking', { selector })
    await page.click(selector)
  }

  async type(selector: string, text: string, pressEnter = false): Promise<void> {
    const page = this.requirePage()
    logger.info('typing', { selector, textLength: text.length, pressEnter })
    await page.fill(selector, text)
    if (pressEnter) {
      await page.press(selector, 'Enter')
    }
  }

  async screenshot(fullPage = false, selector?: string): Promise<ScreenshotResult> {
    const page = this.requirePage()
    logger.info('taking screenshot', { fullPage, selector })

    let buffer: Buffer
    if (selector) {
      const element = page.locator(selector)
      buffer = await element.screenshot({ type: 'png' })
    } else {
      buffer = await page.screenshot({ type: 'png', fullPage })
    }

    const title = await page.title()
    return {
      base64Image: buffer.toString('base64'),
      mimeType: 'image/png',
      pageTitle: title,
      url: page.url(),
    }
  }

  async extractText(selector?: string): Promise<string> {
    const page = this.requirePage()
    logger.info('extracting text', { selector })

    if (selector) {
      return page.innerText(selector)
    }
    return page.innerText('body')
  }

  async fillForm(fields: ReadonlyArray<{ selector: string; value: string }>): Promise<string[]> {
    const page = this.requirePage()
    const filled: string[] = []

    for (const field of fields) {
      logger.info('filling field', { selector: field.selector })
      await page.fill(field.selector, field.value)
      filled.push(field.selector)
    }

    return filled
  }

  async close(): Promise<void> {
    logger.info('closing browser session')
    if (this.page) {
      await this.page.close().catch(() => {})
      this.page = null
    }
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }

  isActive(): boolean {
    return this.browser !== null && this.page !== null
  }

  getCurrentUrl(): string | null {
    return this.page?.url() ?? null
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('Browser not initialized — call browserNavigate first to open a page')
    }
    return this.page
  }
}
