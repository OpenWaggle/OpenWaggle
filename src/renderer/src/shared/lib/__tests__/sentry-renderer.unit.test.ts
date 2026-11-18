import type { ErrorEvent } from '@sentry/electron/renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => {
  const integration = (name: string) => () => ({ name })
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    dedupeIntegration: integration('Dedupe'),
    eventFiltersIntegration: integration('EventFilters'),
    globalHandlersIntegration: integration('GlobalHandlers'),
    linkedErrorsIntegration: integration('LinkedErrors'),
  }
})

vi.mock('@sentry/electron/renderer', () => sentry)

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

  it('initializes Sentry once and reports caught errors', () => {
    const reporter = startSentryRendererErrorReporter()
    const error = new Error('render failed')

    reporter.captureException(error)

    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.captureException).toHaveBeenCalledWith(error)
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
