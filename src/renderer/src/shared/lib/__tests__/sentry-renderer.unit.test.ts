import type { ErrorEvent } from '@sentry/electron/renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => {
  const integration = (name: string) => (): { readonly name: string } => ({ name })
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
    expect(options.tracesSampleRate).toBeUndefined()
    expect(options.dsn).toBeUndefined()
    expect(options.tunnel).toBeUndefined()
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
})
