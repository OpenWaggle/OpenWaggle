import { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedToolResult, ToolContext } from '../../define-tool'
import { runWithToolContext } from '../../define-tool'

// ---------------------------------------------------------------------------
// Mock: browser session registry
// ---------------------------------------------------------------------------

const mockSession = {
  click: vi.fn<(selector: string) => Promise<void>>().mockResolvedValue(undefined),
  type: vi
    .fn<(selector: string, text: string, pressEnter?: boolean) => Promise<void>>()
    .mockResolvedValue(undefined),
  navigate: vi
    .fn<
      (
        url: string,
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle',
      ) => Promise<{ title: string; url: string; status: number | null }>
    >()
    .mockResolvedValue({ title: 'Test Page', url: 'https://example.com', status: 200 }),
  screenshot: vi
    .fn<
      (
        fullPage?: boolean,
        selector?: string,
      ) => Promise<{ base64Image: string; mimeType: string; pageTitle: string; url: string }>
    >()
    .mockResolvedValue({
      base64Image: 'abc123',
      mimeType: 'image/png',
      pageTitle: 'Test Page',
      url: 'https://example.com',
    }),
  extractText: vi.fn<(selector?: string) => Promise<string>>().mockResolvedValue('Hello World'),
  fillForm: vi
    .fn<(fields: ReadonlyArray<{ selector: string; value: string }>) => Promise<string[]>>()
    .mockResolvedValue(['#name', '#email']),
  ensureBrowser: vi.fn<(headless: boolean) => Promise<void>>().mockResolvedValue(undefined),
  close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

const mockCloseSession = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('../../../browser', () => ({
  getOrCreateSession: () => mockSession,
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
}))

// ---------------------------------------------------------------------------
// Mock: settings store (used by browser-navigate)
// ---------------------------------------------------------------------------

vi.mock('../../../store/settings', () => ({
  getSettings: () => ({ browserHeadless: true }),
}))

// ---------------------------------------------------------------------------
// Mock: http utils (used by web-fetch)
// ---------------------------------------------------------------------------

const mockReadBodyWithLimit = vi.fn((..._args: unknown[]): Promise<string> => Promise.resolve(''))
const mockStripHtml = vi.fn((..._args: unknown[]): string => '')

vi.mock('../../../utils/http', () => ({
  readBodyWithLimit: (...args: unknown[]) => mockReadBodyWithLimit(...args),
  stripHtml: (...args: unknown[]) => mockStripHtml(...args),
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { browserClickTool } from './browser-click'
import { browserCloseTool } from './browser-close'
import { browserExtractTextTool } from './browser-extract-text'
import { browserFillFormTool } from './browser-fill-form'
import { browserNavigateTool } from './browser-navigate'
import { browserScreenshotTool } from './browser-screenshot'
import { browserTypeTool } from './browser-type'
import { webFetchTool } from './web-fetch'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONVERSATION_ID = ConversationId('test-conv-123')

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    conversationId: TEST_CONVERSATION_ID,
    projectPath: '/tmp/test-project',
    signal: new AbortController().signal,
    ...overrides,
  }
}

/**
 * Execute a tool within a ToolContext.
 * The TanStack AI server wrapper normalizes all string returns from the inner
 * `execute()` through `normalizeToolResult()`, so the result is always a
 * `NormalizedToolResult` — either `{ kind: 'text', text }` or `{ kind: 'json', data }`.
 */
function executeTool(
  tool: { execute?: (args: unknown) => Promise<unknown> },
  args: unknown,
  ctx: ToolContext,
): Promise<NormalizedToolResult> {
  // biome-ignore lint/style/noNonNullAssertion: test helper — execute is always present on ServerTool
  return runWithToolContext(ctx, () => tool.execute!(args)) as Promise<NormalizedToolResult>
}

/** Convenience: extract the text string from a { kind: 'text' } result */
function expectText(result: NormalizedToolResult): string {
  expect(result.kind).toBe('text')
  if (result.kind !== 'text') throw new Error('Expected text result')
  return result.text
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('browserClickTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls session.click with the given selector', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserClickTool, { selector: '#submit-btn' }, ctx)
    expect(mockSession.click).toHaveBeenCalledWith('#submit-btn')
    expect(expectText(result)).toBe('Clicked element matching "#submit-btn"')
  })

  it('passes different selectors through correctly', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserClickTool, { selector: 'button.primary' }, ctx)
    expect(mockSession.click).toHaveBeenCalledWith('button.primary')
    expect(expectText(result)).toContain('button.primary')
  })
})

describe('browserCloseTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls closeSession with the conversation id', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserCloseTool, {}, ctx)
    expect(mockCloseSession).toHaveBeenCalledWith(TEST_CONVERSATION_ID)
    expect(expectText(result)).toBe('Browser closed.')
  })
})

describe('browserExtractTextTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('extracts text from the whole page when no selector given', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserExtractTextTool, {}, ctx)
    expect(mockSession.extractText).toHaveBeenCalledWith(undefined)
    expect(expectText(result)).toBe('Hello World')
  })

  it('extracts text from a specific selector', async () => {
    mockSession.extractText.mockResolvedValueOnce('Scoped text')
    const ctx = makeContext()
    const result = await executeTool(browserExtractTextTool, { selector: '#main-content' }, ctx)
    expect(mockSession.extractText).toHaveBeenCalledWith('#main-content')
    expect(expectText(result)).toBe('Scoped text')
  })
})

describe('browserFillFormTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls session.fillForm and returns summary', async () => {
    const fields = [
      { selector: '#name', value: 'Alice' },
      { selector: '#email', value: 'alice@example.com' },
    ]
    const ctx = makeContext()
    const result = await executeTool(browserFillFormTool, { fields }, ctx)
    expect(mockSession.fillForm).toHaveBeenCalledWith(fields)
    expect(expectText(result)).toBe('Filled 2 field(s): #name, #email')
  })

  it('handles single field', async () => {
    mockSession.fillForm.mockResolvedValueOnce(['#search'])
    const fields = [{ selector: '#search', value: 'test query' }]
    const ctx = makeContext()
    const result = await executeTool(browserFillFormTool, { fields }, ctx)
    expect(expectText(result)).toBe('Filled 1 field(s): #search')
  })
})

describe('browserNavigateTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ensures browser, navigates, and returns json result', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserNavigateTool, { url: 'https://example.com' }, ctx)
    expect(mockSession.ensureBrowser).toHaveBeenCalledWith(true)
    expect(mockSession.navigate).toHaveBeenCalledWith('https://example.com', undefined)
    expect(result).toEqual({
      kind: 'json',
      data: { title: 'Test Page', url: 'https://example.com', status: 200 },
    })
  })

  it('passes waitUntil option through', async () => {
    const ctx = makeContext()
    await executeTool(
      browserNavigateTool,
      { url: 'https://test.com', waitUntil: 'networkidle' },
      ctx,
    )
    expect(mockSession.navigate).toHaveBeenCalledWith('https://test.com', 'networkidle')
  })
})

describe('browserScreenshotTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes a default screenshot and returns json result', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserScreenshotTool, {}, ctx)
    expect(mockSession.screenshot).toHaveBeenCalledWith(undefined, undefined)
    expect(result).toEqual({
      kind: 'json',
      data: {
        base64Image: 'abc123',
        mimeType: 'image/png',
        pageTitle: 'Test Page',
        url: 'https://example.com',
      },
    })
  })

  it('passes fullPage and selector options', async () => {
    const ctx = makeContext()
    await executeTool(browserScreenshotTool, { fullPage: true, selector: '#hero' }, ctx)
    expect(mockSession.screenshot).toHaveBeenCalledWith(true, '#hero')
  })
})

describe('browserTypeTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('types text without pressing Enter', async () => {
    const ctx = makeContext()
    const result = await executeTool(browserTypeTool, { selector: '#search', text: 'hello' }, ctx)
    expect(mockSession.type).toHaveBeenCalledWith('#search', 'hello', undefined)
    expect(expectText(result)).toBe('Typed into "#search"')
  })

  it('types text and presses Enter', async () => {
    const ctx = makeContext()
    const result = await executeTool(
      browserTypeTool,
      { selector: '#search', text: 'hello', pressEnter: true },
      ctx,
    )
    expect(mockSession.type).toHaveBeenCalledWith('#search', 'hello', true)
    expect(expectText(result)).toBe('Typed into "#search" and pressed Enter')
  })

  it('includes no suffix when pressEnter is false', async () => {
    const ctx = makeContext()
    const result = await executeTool(
      browserTypeTool,
      { selector: 'input', text: 'world', pressEnter: false },
      ctx,
    )
    expect(expectText(result)).toBe('Typed into "input"')
  })
})

describe('webFetchTool', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadBodyWithLimit.mockResolvedValue('plain text body')
    mockStripHtml.mockImplementation((...args: unknown[]) => `stripped(${args[0]})`)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetchResponse(options: {
    ok?: boolean
    status?: number
    statusText?: string
    contentType?: string
  }): void {
    const { ok = true, status = 200, statusText = 'OK', contentType = 'text/plain' } = options
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
      ok,
      status,
      statusText,
      headers: new Headers({ 'content-type': contentType }),
      body: null,
    } as unknown as Response)
  }

  it('fetches a URL and returns plain text', async () => {
    mockFetchResponse({ contentType: 'text/plain' })
    mockReadBodyWithLimit.mockResolvedValueOnce('Hello from the web')
    const ctx = makeContext()

    const result = await executeTool(webFetchTool, { url: 'https://example.com/api' }, ctx)
    expect(expectText(result)).toBe('Hello from the web')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        headers: { 'User-Agent': 'OpenWaggle/1.0' },
      }),
    )
  })

  it('strips HTML when content-type is text/html', async () => {
    mockFetchResponse({ contentType: 'text/html; charset=utf-8' })
    mockReadBodyWithLimit.mockResolvedValueOnce('<p>Hello</p>')
    mockStripHtml.mockReturnValueOnce('Hello')
    const ctx = makeContext()

    const result = await executeTool(webFetchTool, { url: 'https://example.com' }, ctx)
    expect(mockStripHtml).toHaveBeenCalledWith('<p>Hello</p>')
    expect(expectText(result)).toBe('Hello')
  })

  it('does not strip non-HTML content types', async () => {
    mockFetchResponse({ contentType: 'application/json' })
    // Return non-JSON-parseable text so it stays as kind:'text'
    mockReadBodyWithLimit.mockResolvedValueOnce('not json content')
    const ctx = makeContext()

    const result = await executeTool(webFetchTool, { url: 'https://api.example.com/data' }, ctx)
    expect(mockStripHtml).not.toHaveBeenCalled()
    expect(expectText(result)).toBe('not json content')
  })

  it('returns JSON-parseable responses as kind:json', async () => {
    mockFetchResponse({ contentType: 'application/json' })
    mockReadBodyWithLimit.mockResolvedValueOnce('{"key":"value"}')
    const ctx = makeContext()

    const result = await executeTool(webFetchTool, { url: 'https://api.example.com/data' }, ctx)
    // The normalizeToolResult in define-tool detects JSON-parseable strings
    expect(result.kind).toBe('json')
    if (result.kind === 'json') {
      expect(result.data).toEqual({ key: 'value' })
    }
  })

  it('truncates text exceeding maxLength', async () => {
    mockFetchResponse({ contentType: 'text/plain' })
    const longText = 'a'.repeat(100)
    mockReadBodyWithLimit.mockResolvedValueOnce(longText)
    const ctx = makeContext()

    const result = await executeTool(
      webFetchTool,
      { url: 'https://example.com', maxLength: 50 },
      ctx,
    )
    const text = expectText(result)
    expect(text).toContain('a'.repeat(50))
    expect(text).toContain('truncated')
    expect(text).toContain('100 chars total')
    expect(text).toContain('showing first 50')
  })

  it('does not truncate text under default maxLength', async () => {
    mockFetchResponse({ contentType: 'text/plain' })
    mockReadBodyWithLimit.mockResolvedValueOnce('short content')
    const ctx = makeContext()

    const result = await executeTool(webFetchTool, { url: 'https://example.com' }, ctx)
    expect(expectText(result)).toBe('short content')
  })

  it('throws on non-OK HTTP responses', async () => {
    mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found' })
    const ctx = makeContext()

    await expect(
      executeTool(webFetchTool, { url: 'https://example.com/missing' }, ctx),
    ).rejects.toThrow('HTTP 404 Not Found for https://example.com/missing')
  })

  it('throws on 500 server error', async () => {
    mockFetchResponse({ ok: false, status: 500, statusText: 'Internal Server Error' })
    const ctx = makeContext()

    await expect(
      executeTool(webFetchTool, { url: 'https://example.com/error' }, ctx),
    ).rejects.toThrow('HTTP 500 Internal Server Error for https://example.com/error')
  })

  it('includes abort signal in fetch options', async () => {
    mockFetchResponse({})
    mockReadBodyWithLimit.mockResolvedValueOnce('ok')
    const controller = new AbortController()
    const ctx = makeContext({ signal: controller.signal })

    await executeTool(webFetchTool, { url: 'https://example.com' }, ctx)
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const options = fetchCall[1]
    expect(options?.signal).toBeDefined()
  })

  it('uses timeout-only signal when context has no signal', async () => {
    mockFetchResponse({})
    mockReadBodyWithLimit.mockResolvedValueOnce('ok')
    const ctx = makeContext({ signal: undefined })

    const result = await executeTool(webFetchTool, { url: 'https://example.com' }, ctx)
    expect(expectText(result)).toBe('ok')
    // Should still have a timeout-based signal
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const options = fetchCall[1]
    expect(options?.signal).toBeDefined()
  })

  it('calls readBodyWithLimit with 5MB cap', async () => {
    mockFetchResponse({})
    mockReadBodyWithLimit.mockResolvedValueOnce('body content')
    const ctx = makeContext()

    await executeTool(webFetchTool, { url: 'https://example.com' }, ctx)
    expect(mockReadBodyWithLimit).toHaveBeenCalledWith(expect.anything(), 5 * 1024 * 1024)
  })
})
