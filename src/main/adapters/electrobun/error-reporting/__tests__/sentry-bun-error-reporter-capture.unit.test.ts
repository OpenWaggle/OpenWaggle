import { fromAny } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => {
  const integration =
    (name: string) =>
    (options?: unknown): { readonly name: string; readonly options?: unknown } => ({
      name,
      options,
    })
  const transportSend = vi.fn(async (_envelope: unknown) => ({ statusCode: 200 }))
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    flush: vi.fn(async (_timeout?: number) => true),
    transportSend,
    captureEvent: vi.fn(),
    makeFetchTransport: vi.fn(() => ({ send: transportSend, flush: vi.fn(async () => true) })),
    dedupeIntegration: integration('Dedupe'),
    eventFiltersIntegration: integration('EventFilters'),
    linkedErrorsIntegration: integration('LinkedErrors'),
    rewriteFramesIntegration: integration('RewriteFrames'),
    onUncaughtExceptionIntegration: integration('OnUncaughtException'),
    onUnhandledRejectionIntegration: integration('OnUnhandledRejection'),
  }
})

vi.mock('@sentry/bun', () => sentry)

import {
  createSentryMainOptions,
  processExitIntegration,
  type SentryBunErrorReporterInput,
  startSentryMainErrorReporter,
} from '../sentry-bun-error-reporter'

const HANDLED = { type: 'generic', handled: true }

function reporterInput(): SentryBunErrorReporterInput {
  return {
    process: 'gui',
    release: 'openwaggle@1.0.0-beta.4',
    environment: 'beta',
    homeDirectory: '/Users/alice',
    temporaryDirectory: '/var/folders/73/abc123/T',
    isEnabled: () => true,
    operatingSystem: { name: 'macOS', version: '15.2' },
    arch: 'arm64',
    appRoot: '/Applications/OpenWaggle.app/Contents/Resources/app',
  }
}

describe('process exit integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports an abnormal end of a renderer or helper by type and reason only', () => {
    let report: ((exitedProcess: string, reason: string) => void) | undefined
    const integration = processExitIntegration((listener) => {
      report = listener
    })

    integration.setupOnce?.()
    report?.('GPU', 'crashed')
    report?.('renderer', 'abnormal-exit')
    report?.('Utility', 'clean-exit')
    report?.('renderer', 'killed')

    expect(sentry.captureMessage.mock.calls).toEqual([
      [
        "'GPU' process exited with 'crashed'",
        {
          level: 'fatal',
          tags: { 'openwaggle.exited_process': 'GPU', 'openwaggle.process_exit': 'crashed' },
          fingerprint: ['process-exit', 'GPU', 'crashed'],
        },
      ],
      [
        "'renderer' process exited with 'abnormal-exit'",
        {
          level: 'warning',
          tags: {
            'openwaggle.exited_process': 'renderer',
            'openwaggle.process_exit': 'abnormal-exit',
          },
          fingerprint: ['process-exit', 'renderer', 'abnormal-exit'],
        },
      ],
    ])
  })
})

describe('main-process error reporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes Sentry once and hands the origin it was given to its own beforeSend', async () => {
    const reporter = startSentryMainErrorReporter(reporterInput())
    const error = new Error('tool failed')

    reporter.captureException(error, 'tool-execution')
    reporter.captureException(error)
    await reporter.flush(2_000)

    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.captureException).toHaveBeenNthCalledWith(1, error, {
      data: { openwaggleReportedOrigin: 'tool-execution' },
    })
    expect(sentry.captureException).toHaveBeenNthCalledWith(2, error, {})
    expect(sentry.flush).toHaveBeenCalledWith(2_000)
  })

  it('keeps the message of an application error only through its own capture hint', async () => {
    const reporter = startSentryMainErrorReporter(reporterInput())
    const options = createSentryMainOptions(reporterInput())

    reporter.captureException(new Error('Settings migration 7 failed'), 'application')
    const hint: unknown = sentry.captureException.mock.calls[0]?.[1]
    const sent = await options.beforeSend?.(
      {
        type: undefined,
        exception: {
          values: [{ type: 'Error', value: 'Settings migration 7 failed', mechanism: HANDLED }],
        },
      },
      fromAny(hint),
    )

    expect(sent?.exception?.values?.[0]?.value).toBe('Settings migration 7 failed')
    expect(sent?.tags).toEqual({ 'openwaggle.error_origin': 'application' })
  })

  it("keeps only the basename of a Pi extension's frames in a Session Host report", async () => {
    const options = createSentryMainOptions(reporterInput())
    const extension = '/Users/alice/work/acme-secret/.pi/extensions/foo/index.ts'

    const sent = await options.beforeSend?.(
      {
        type: undefined,
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'x is undefined',
              mechanism: { type: 'auto.node.onuncaughtexception', handled: false },
              stacktrace: {
                frames: [
                  { filename: 'app:///out/main/index.js', function: 'runTurn' },
                  { filename: extension, abs_path: extension, module: 'foo:index' },
                ],
              },
            },
          ],
        },
      },
      {},
    )

    expect(sent?.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { filename: 'app:///out/main/index.js', function: 'runTurn' },
      { filename: '<external>/index.ts', abs_path: '<external>/index.ts' },
    ])
  })

  it("re-captures a renderer envelope's error events and nothing else, under main's release", () => {
    const reporter = startSentryMainErrorReporter(reporterInput())
    const error = { exception: { values: [{ type: 'TypeError', value: 'x' }] } }
    // The browser SDK always names an environment, its default `production` without one.
    const rendererEvent = { ...error, environment: 'production', release: 'renderer@0' }
    const envelope = [
      JSON.stringify({ sent_at: '2026-11-11T00:00:00Z' }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(rendererEvent),
      JSON.stringify({ type: 'session' }),
      JSON.stringify({ sid: 'renderer-session' }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({ type: 'transaction', transaction: '/settings' }),
    ].join('\n')

    reporter.captureRendererEnvelope?.(envelope)
    reporter.captureRendererEnvelope?.('not an envelope')

    expect(sentry.captureEvent.mock.calls).toEqual([[error]])
  })

  it('stops waiting for pending reports once the timeout passes', async () => {
    vi.useFakeTimers()
    sentry.flush.mockImplementationOnce(() => new Promise<boolean>(() => {}))
    const reporter = startSentryMainErrorReporter(reporterInput())

    const flushed = reporter.flush(2_000)
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(flushed).resolves.toBeUndefined()
  })
})
