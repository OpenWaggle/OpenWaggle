import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPage, mockContext, mockBrowser, mockLocator, chromiumLaunchMock } = vi.hoisted(() => {
  const mockLocator = {
    screenshot: vi.fn(),
  }
  const mockPage = {
    goto: vi.fn(),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    click: vi.fn(),
    fill: vi.fn(),
    press: vi.fn(),
    screenshot: vi.fn(),
    innerText: vi.fn(),
    locator: vi.fn().mockReturnValue(mockLocator),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const chromiumLaunchMock = vi.fn().mockResolvedValue(mockBrowser)
  return { mockPage, mockContext, mockBrowser, mockLocator, chromiumLaunchMock }
})

vi.mock('playwright', () => ({
  chromium: {
    launch: chromiumLaunchMock,
  },
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { BrowserSession } from './session'

describe('BrowserSession', () => {
  let session: BrowserSession

  beforeEach(() => {
    session = new BrowserSession()
    chromiumLaunchMock.mockClear()
    mockBrowser.newContext.mockClear()
    mockContext.newPage.mockClear()
    mockContext.close.mockClear()
    mockBrowser.close.mockClear()
    mockPage.goto.mockClear()
    mockPage.title.mockClear()
    mockPage.url.mockClear()
    mockPage.click.mockClear()
    mockPage.fill.mockClear()
    mockPage.press.mockClear()
    mockPage.screenshot.mockClear()
    mockPage.innerText.mockClear()
    mockPage.locator.mockClear()
    mockPage.close.mockClear()
    mockLocator.screenshot.mockClear()

    mockPage.title.mockResolvedValue('Test Page')
    mockPage.url.mockReturnValue('https://example.com')
  })

  // ─── ensureBrowser ─────────────────────────────────────────

  describe('ensureBrowser', () => {
    it('launches chromium in headless mode', async () => {
      await session.ensureBrowser(true)

      expect(chromiumLaunchMock).toHaveBeenCalledWith({ headless: true })
      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        viewport: { width: 1280, height: 800 },
      })
      expect(mockContext.newPage).toHaveBeenCalledOnce()
    })

    it('launches chromium in headed mode', async () => {
      await session.ensureBrowser(false)

      expect(chromiumLaunchMock).toHaveBeenCalledWith({ headless: false })
    })

    it('does not re-launch if browser already exists', async () => {
      await session.ensureBrowser(true)
      await session.ensureBrowser(true)

      expect(chromiumLaunchMock).toHaveBeenCalledOnce()
    })
  })

  // ─── navigate ──────────────────────────────────────────────

  describe('navigate', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.navigate('https://example.com')).rejects.toThrow(
        'Browser not initialized',
      )
    })

    it('navigates to URL and returns title, url, status', async () => {
      const mockResponse = { status: () => 200 }
      mockPage.goto.mockResolvedValue(mockResponse)
      mockPage.title.mockResolvedValue('Example')
      mockPage.url.mockReturnValue('https://example.com/')

      await session.ensureBrowser(true)
      const result = await session.navigate('https://example.com')

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'load' })
      expect(result).toEqual({
        title: 'Example',
        url: 'https://example.com/',
        status: 200,
      })
    })

    it('returns null status when response is null', async () => {
      mockPage.goto.mockResolvedValue(null)

      await session.ensureBrowser(true)
      const result = await session.navigate('https://example.com')

      expect(result.status).toBeNull()
    })

    it('uses custom waitUntil option', async () => {
      mockPage.goto.mockResolvedValue({ status: () => 200 })

      await session.ensureBrowser(true)
      await session.navigate('https://example.com', 'networkidle')

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
      })
    })
  })

  // ─── click ─────────────────────────────────────────────────

  describe('click', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.click('#btn')).rejects.toThrow('Browser not initialized')
    })

    it('clicks the given selector', async () => {
      await session.ensureBrowser(true)
      await session.click('#submit-btn')

      expect(mockPage.click).toHaveBeenCalledWith('#submit-btn')
    })
  })

  // ─── type ──────────────────────────────────────────────────

  describe('type', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.type('#input', 'hello')).rejects.toThrow('Browser not initialized')
    })

    it('fills the selector with text', async () => {
      await session.ensureBrowser(true)
      await session.type('#input', 'hello world')

      expect(mockPage.fill).toHaveBeenCalledWith('#input', 'hello world')
      expect(mockPage.press).not.toHaveBeenCalled()
    })

    it('presses Enter after typing when pressEnter is true', async () => {
      await session.ensureBrowser(true)
      await session.type('#search', 'query', true)

      expect(mockPage.fill).toHaveBeenCalledWith('#search', 'query')
      expect(mockPage.press).toHaveBeenCalledWith('#search', 'Enter')
    })
  })

  // ─── screenshot ────────────────────────────────────────────

  describe('screenshot', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.screenshot()).rejects.toThrow('Browser not initialized')
    })

    it('takes viewport screenshot by default', async () => {
      const buf = Buffer.from('png-data')
      mockPage.screenshot.mockResolvedValue(buf)
      mockPage.title.mockResolvedValue('Screenshot Page')
      mockPage.url.mockReturnValue('https://example.com/page')

      await session.ensureBrowser(true)
      const result = await session.screenshot()

      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false })
      expect(result).toEqual({
        base64Image: buf.toString('base64'),
        mimeType: 'image/png',
        pageTitle: 'Screenshot Page',
        url: 'https://example.com/page',
      })
    })

    it('takes full-page screenshot when fullPage is true', async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from('full'))

      await session.ensureBrowser(true)
      await session.screenshot(true)

      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true })
    })

    it('takes element screenshot when selector is provided', async () => {
      const buf = Buffer.from('element-png')
      mockLocator.screenshot.mockResolvedValue(buf)

      await session.ensureBrowser(true)
      const result = await session.screenshot(false, '#hero-image')

      expect(mockPage.locator).toHaveBeenCalledWith('#hero-image')
      expect(mockLocator.screenshot).toHaveBeenCalledWith({ type: 'png' })
      expect(result.base64Image).toBe(buf.toString('base64'))
    })
  })

  // ─── extractText ───────────────────────────────────────────

  describe('extractText', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.extractText()).rejects.toThrow('Browser not initialized')
    })

    it('extracts body text when no selector provided', async () => {
      mockPage.innerText.mockResolvedValue('Page content here')

      await session.ensureBrowser(true)
      const text = await session.extractText()

      expect(mockPage.innerText).toHaveBeenCalledWith('body')
      expect(text).toBe('Page content here')
    })

    it('extracts text from specific selector', async () => {
      mockPage.innerText.mockResolvedValue('Section text')

      await session.ensureBrowser(true)
      const text = await session.extractText('#main-content')

      expect(mockPage.innerText).toHaveBeenCalledWith('#main-content')
      expect(text).toBe('Section text')
    })
  })

  // ─── fillForm ──────────────────────────────────────────────

  describe('fillForm', () => {
    it('throws if browser not initialized', async () => {
      await expect(session.fillForm([{ selector: '#name', value: 'John' }])).rejects.toThrow(
        'Browser not initialized',
      )
    })

    it('fills multiple form fields and returns filled selectors', async () => {
      await session.ensureBrowser(true)
      const filled = await session.fillForm([
        { selector: '#name', value: 'Alice' },
        { selector: '#email', value: 'alice@example.com' },
      ])

      expect(mockPage.fill).toHaveBeenCalledWith('#name', 'Alice')
      expect(mockPage.fill).toHaveBeenCalledWith('#email', 'alice@example.com')
      expect(filled).toEqual(['#name', '#email'])
    })

    it('returns empty array for empty fields list', async () => {
      await session.ensureBrowser(true)
      const filled = await session.fillForm([])

      expect(filled).toEqual([])
      expect(mockPage.fill).not.toHaveBeenCalled()
    })
  })

  // ─── close ─────────────────────────────────────────────────

  describe('close', () => {
    it('closes page, context, and browser in order', async () => {
      await session.ensureBrowser(true)
      await session.close()

      expect(mockPage.close).toHaveBeenCalledOnce()
      expect(mockContext.close).toHaveBeenCalledOnce()
      expect(mockBrowser.close).toHaveBeenCalledOnce()
    })

    it('is safe to call when browser was never opened', async () => {
      // Should not throw
      await session.close()
    })

    it('suppresses errors from page/context/browser close', async () => {
      mockPage.close.mockRejectedValue(new Error('close failed'))
      mockContext.close.mockRejectedValue(new Error('close failed'))
      mockBrowser.close.mockRejectedValue(new Error('close failed'))

      await session.ensureBrowser(true)
      // Should not throw
      await session.close()
    })

    it('sets internal state to null so isActive returns false', async () => {
      await session.ensureBrowser(true)
      expect(session.isActive()).toBe(true)

      await session.close()
      expect(session.isActive()).toBe(false)
    })
  })

  // ─── isActive ──────────────────────────────────────────────

  describe('isActive', () => {
    it('returns false before browser is launched', () => {
      expect(session.isActive()).toBe(false)
    })

    it('returns true after browser is launched', async () => {
      await session.ensureBrowser(true)
      expect(session.isActive()).toBe(true)
    })
  })

  // ─── getCurrentUrl ─────────────────────────────────────────

  describe('getCurrentUrl', () => {
    it('returns null when no page exists', () => {
      expect(session.getCurrentUrl()).toBeNull()
    })

    it('returns the current page URL', async () => {
      mockPage.url.mockReturnValue('https://example.com/dashboard')

      await session.ensureBrowser(true)
      expect(session.getCurrentUrl()).toBe('https://example.com/dashboard')
    })
  })
})
