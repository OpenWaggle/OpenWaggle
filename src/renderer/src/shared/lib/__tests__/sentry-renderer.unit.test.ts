import * as SentryBrowser from '@sentry/browser'
import type { ErrorEvent } from '@sentry/browser'
import { parseEnvelope } from '@sentry/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronRenderer = vi.hoisted(() => ({ init: vi.fn() }))

vi.mock('@sentry/electron/renderer', () => electronRenderer)
// The browser SDK runs for real; the spies only record what the adapter asked of it.
vi.mock('@sentry/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof SentryBrowser>()
  return {
    ...actual,
    init: vi.fn(actual.init),
    captureException: vi.fn(actual.captureException),
  }
})

import { createSentryRendererOptions, startSentryRendererErrorReporter } from '../sentry-renderer'

describe('Sentry renderer options', () => {
  beforeEach(() => vi.clearAllMocks())

  it('installs only error-capturing integrations and turns off PII and breadcrumbs', () => {
    const options = createSentryRendererOptions()
    const names = Array.isArray(options.integrations)
      ? options.integrations.map((integration) => integration.name)
      : []

    expect(options.defaultIntegrations).toBe(false)
    expect(names).toEqual(['EventFilters', 'GlobalHandlers', 'LinkedErrors', 'Dedupe'])
    for (const forbidden of [
      'Breadcrumbs',
      'BrowserSession',
      'BrowserTracing',
      'HttpContext',
      'Replay',
      'ScopeToMain',
      'BrowserApiErrors',
    ]) {
      expect(names).not.toContain(forbidden)
    }
    expect(options).not.toHaveProperty('sendDefaultPii')
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      stackFrameVariables: false,
      frameContextLines: 0,
    })
    expect(options.maxBreadcrumbs).toBe(0)
    expect(options.beforeBreadcrumb?.({ message: 'clicked' })).toBeNull()
    expect(options).not.toHaveProperty('tracesSampleRate')
    // The DSN belongs to the main process only; the renderer options never carry one.
    expect(options).not.toHaveProperty('dsn')
    expect(options).not.toHaveProperty('tunnel')
  })

  it('drops message text and request data before a report leaves the renderer', async () => {
    const unhandled = { type: 'auto.browser.global_handlers.onerror', handled: false }
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "cannot open C:\\Users\\Sean O'Brien\\plan.md",
            mechanism: unhandled,
            stacktrace: {
              frames: [
                { filename: 'openwaggle://app/assets/index-Bx1.js' },
                { filename: "C:\\Users\\Sean O'Brien\\x.js" },
              ],
            },
          },
        ],
      },
      extra: { cwd: "C:\\Users\\Sean O'Brien" },
      request: { url: 'openwaggle://renderer/index.html#/sessions/0199a1b2' },
    }

    // Text stays for the main process, which knows the home directory and scrubs it; frames
    // outside the app's own code are already reduced to <external>.
    expect(await createSentryRendererOptions().beforeSend?.(event, {})).toEqual({
      type: undefined,
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'unknown',
            mechanism: unhandled,
            stacktrace: {
              frames: [
                { filename: 'openwaggle://app/assets/index-Bx1.js' },
                { filename: '<external>' },
              ],
            },
          },
        ],
      },
      tags: { 'openwaggle.error_origin': 'unhandled' },
    })
  })

  it('starts the Electron renderer SDK over its IPC bridge on Electron', () => {
    const reporter = startSentryRendererErrorReporter('sentry-ipc')
    const error = new Error('render failed')

    reporter.captureException(error)

    expect(electronRenderer.init).toHaveBeenCalledOnce()
    expect(SentryBrowser.init).not.toHaveBeenCalled()
    expect(SentryBrowser.captureException).toHaveBeenCalledWith(error)
  })

  it('tags a report with the API method whose rejected call reported it', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Unit tests have no window.api, so the bridge rejects with its own missing-method error,
    // which the wrapper tags with the method name exactly like a preload rejection.
    const { api } = await import('../ipc')
    const rejected = await api.getSettings().then(
      () => undefined,
      (error: unknown) => error,
    )

    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: 'Error',
            value: 'connect ECONNREFUSED 127.0.0.1:443',
            mechanism: {
              type: 'auto.browser.global_handlers.onunhandledrejection',
              handled: false,
            },
          },
        ],
      },
    }
    const untagged: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: 'Error',
            value: 'getaddrinfo ENOTFOUND api.example.com',
            mechanism: {
              type: 'auto.browser.global_handlers.onunhandledrejection',
              handled: false,
            },
          },
        ],
      },
    }

    const options = createSentryRendererOptions()
    const tagged = await options.beforeSend?.(event, { originalException: rejected })
    expect(tagged?.tags).toEqual({
      'openwaggle.error_origin': 'unhandled',
      'openwaggle.api_method': 'getSettings',
    })

    const plain = await options.beforeSend?.(untagged, { originalException: new Error() })
    expect(plain?.tags).toEqual({ 'openwaggle.error_origin': 'unhandled' })

    consoleSpy.mockRestore()
  })
})

describe('Sentry renderer on Electrobun', () => {
  const PAGE_BASE = 'http://127.0.0.1:49152/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const sendErrorReportEnvelope = vi.fn((_envelope: string) => undefined)

  beforeEach(() => {
    vi.resetModules()
    sendErrorReportEnvelope.mockClear()
    vi.stubGlobal('window', {
      location: { href: `${PAGE_BASE}/index.html#/sessions/0199a1b2` },
      api: { sendErrorReportEnvelope },
    })
  })

  afterEach(async () => {
    await SentryBrowser.getClient()?.close()
    vi.unstubAllGlobals()
  })

  it('hands each scrubbed error event to the main process as an envelope over the app IPC', async () => {
    const { startSentryRendererErrorReporter: start } = await import('../sentry-renderer')
    const error = new TypeError("cannot open C:\\Users\\Sean O'Brien\\plan.md")
    error.stack = [
      `TypeError: ${error.message}`,
      `    at render (${PAGE_BASE}/assets/index-Bx1.js:10:5)`,
      '    at mount (http://127.0.0.1:50000/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/module/x/dist/settings.js:1:1)',
    ].join('\n')

    start('renderer-envelope').captureException(error)
    await SentryBrowser.flush(1_000)

    expect(electronRenderer.init).not.toHaveBeenCalled()
    expect(sendErrorReportEnvelope).toHaveBeenCalledOnce()
    const [envelope] = sendErrorReportEnvelope.mock.calls[0] ?? []
    const [, items] = parseEnvelope(envelope ?? '')
    expect(items.map(([header]) => header.type)).toEqual(['event'])
    const [[, event]] = items
    expect(event).toMatchObject({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'unknown',
            stacktrace: {
              frames: [
                // Another loopback origin, such as an extension module, is external code.
                { filename: '<external>', function: '<external>' },
                // The page's own code reads as on Electron, without its port or capability.
                { filename: 'openwaggle://app/assets/index-Bx1.js', function: 'render' },
              ],
            },
          },
        ],
      },
    })
    expect(JSON.stringify(event)).not.toContain('127.0.0.1')
  })
})
