import type { ElectronMainOptions, ErrorEvent, EventHint } from '@sentry/electron/main'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    makeElectronTransport: vi.fn(() => ({ send: transportSend, flush: vi.fn(async () => true) })),
    IPCMode: { Classic: 1, Protocol: 2, Both: 3 },
    dedupeIntegration: integration('Dedupe'),
    electronContextIntegration: integration('ElectronContext'),
    eventFiltersIntegration: integration('EventFilters'),
    linkedErrorsIntegration: integration('LinkedErrors'),
    normalizePathsIntegration: integration('NormalizePaths'),
    onUncaughtExceptionIntegration: integration('OnUncaughtException'),
    onUnhandledRejectionIntegration: integration('OnUnhandledRejection'),
  }
})

vi.mock('@sentry/electron/main', () => sentry)
const electron = vi.hoisted(() => ({
  app: { on: vi.fn() },
  ipcMain: { removeAllListeners: vi.fn() },
}))

vi.mock('electron', () => electron)

import {
  createSentryMainOptions,
  type SentryMainErrorReporterInput,
} from '../sentry-main-error-reporter'

/** Integrations that capture something other than errors, upload crash dumps or hook children. */
const FORBIDDEN_INTEGRATIONS = [
  'SentryMinidump',
  'ElectronMinidump',
  'ElectronBreadcrumbs',
  'ElectronNet',
  'Breadcrumbs',
  'ChildProcess',
  'Console',
  'CaptureConsole',
  'NodeFetch',
  'Http',
  'Screenshots',
  'LocalVariables',
  'LocalVariablesAsync',
  'ContextLines',
  'Context',
  'Modules',
  'AdditionalContext',
  'GpuContext',
  'MainProcessSession',
  'BrowserWindowSession',
  'BrowserSession',
  'StartupTracing',
  'RendererEventLoopBlock',
  'RendererProfiling',
  'PreloadInjection',
  'Replay',
  'BrowserTracing',
]

const HANDLED = { type: 'generic', handled: true }

function reporterInput(isEnabled: () => boolean): SentryMainErrorReporterInput {
  return {
    process: 'session-host',
    release: 'openwaggle@1.0.0-beta.4',
    environment: 'beta',
    homeDirectory: '/Users/alice',
    temporaryDirectory: '/var/folders/73/abc123/T',
    isEnabled,
    operatingSystem: { name: 'macOS', version: '15.2' },
    arch: 'arm64',
  }
}

function integrationsOf(options: ElectronMainOptions) {
  return Array.isArray(options.integrations) ? options.integrations : []
}

function handledErrorEvent(): ErrorEvent {
  return {
    type: undefined,
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Could not read /Users/alice/repo/secret.ts in /var/folders/73/abc123/T',
          mechanism: HANDLED,
        },
      ],
    },
    user: { ip_address: '203.0.113.7' },
    breadcrumbs: [{ message: 'clicked' }],
  }
}

const NO_HINT: EventHint = {}
/** The provider SDK the app ships threw the error, so its error class is kept. */
const PROVIDER_SDK_FRAME = { filename: 'app:///node_modules/openai/core.js', function: 'request' }
/** The hint the adapter's own capture gives an `application` report. */
const APPLICATION_HINT: EventHint = { data: { openwaggleReportedOrigin: 'application' } }

const NO_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
  frameContextLines: 0,
}

describe('Sentry main-process options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts to the OpenWaggle tunnel under the placeholder DSN, release and build channel', () => {
    const options = createSentryMainOptions(reporterInput(() => true))

    expect(options).toMatchObject({
      dsn: 'https://openwaggle@openwaggle.ai/1',
      tunnel: 'https://openwaggle.ai/api/v1/errors',
      release: 'openwaggle@1.0.0-beta.4',
      environment: 'beta',
    })
  })

  it('installs only error-capturing integrations', () => {
    const options = createSentryMainOptions(reporterInput(() => true))
    const names = integrationsOf(options).map((integration) => integration.name)

    expect(options.defaultIntegrations).toBe(false)
    expect(names).toEqual([
      'EventFilters',
      'LinkedErrors',
      'Dedupe',
      'OnUncaughtException',
      'OnUnhandledRejection',
      'OpenWaggleProcessExit',
      'ElectronContext',
      'NormalizePaths',
    ])
    for (const forbidden of FORBIDDEN_INTEGRATIONS) expect(names).not.toContain(forbidden)
  })

  it('turns off PII, breadcrumbs, screenshots, local variables, logs, tracing and profiling', () => {
    const options = createSentryMainOptions(reporterInput(() => true))

    expect(options).not.toHaveProperty('sendDefaultPii')
    expect(options.dataCollection).toEqual(NO_DATA_COLLECTION)
    expect(options).toMatchObject({
      sendClientReports: false,
      maxBreadcrumbs: 0,
      attachStacktrace: false,
      attachScreenshot: false,
      enableRendererProfiling: false,
      includeLocalVariables: false,
      enableLogs: false,
      skipOpenTelemetrySetup: true,
      ipcMode: sentry.IPCMode.Classic,
    })
    expect(options.tracesSampleRate).toBeUndefined()
    expect(options.tracesSampler).toBeUndefined()
    expect(options.beforeBreadcrumb?.({ message: 'clicked' })).toBeNull()
    expect(options.initialScope).toEqual({
      tags: { 'openwaggle.process': 'session-host' },
      contexts: { os: { name: 'macOS', version: '15.2' }, device: { arch: 'arm64' } },
    })
  })

  it('drops every report while Usage statistics are off', async () => {
    let enabled = false
    const options = createSentryMainOptions(reporterInput(() => enabled))

    expect(await options.beforeSend?.(handledErrorEvent(), APPLICATION_HINT)).toBeNull()
    expect(
      await options.beforeSendTransaction?.({ type: 'transaction', transaction: 'x' }, NO_HINT),
    ).toBeNull()

    enabled = true
    expect(await options.beforeSend?.(handledErrorEvent(), APPLICATION_HINT)).toEqual({
      type: undefined,
      exception: {
        values: [
          { type: 'Error', value: 'Could not read ~/repo/secret.ts in <tmp>', mechanism: HANDLED },
        ],
      },
      tags: { 'openwaggle.error_origin': 'application' },
    })
  })

  it('ignores an application origin from the scope, which a renderer page can set', async () => {
    const options = createSentryMainOptions(reporterInput(() => true))
    const scopeTagged: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          { type: 'Error', value: 'could not open /Volumes/Work/acme/.env', mechanism: HANDLED },
        ],
      },
      tags: { 'openwaggle.process': 'gui', 'openwaggle.error_origin': 'application' },
    }

    const sent = await options.beforeSend?.(scopeTagged, NO_HINT)

    expect(sent?.exception?.values).toEqual([
      { type: 'Error', value: 'unknown', mechanism: HANDLED },
    ])
    expect(sent?.tags).toEqual({ 'openwaggle.process': 'gui' })
  })

  it("ignores an application origin on a renderer's report", async () => {
    const options = createSentryMainOptions(reporterInput(() => true))
    const rendererEvent: ErrorEvent = {
      ...handledErrorEvent(),
      tags: { 'event.process': 'renderer', 'openwaggle.error_origin': 'application' },
    }

    const sent = await options.beforeSend?.(rendererEvent, { attachments: [] })

    expect(sent?.exception?.values).toEqual([
      { type: 'Error', value: 'unknown', mechanism: HANDLED },
    ])
    expect(sent?.tags).toEqual({ 'event.process': 'renderer' })
  })

  it('reduces a provider error to its type and code before sending', async () => {
    const options = createSentryMainOptions(reporterInput(() => true))
    const providerError = Object.assign(
      new Error('429 Too Many Requests while sending "my secret plan"'),
      { status: 429 },
    )

    const sent = await options.beforeSend?.(
      {
        type: undefined,
        exception: {
          values: [
            {
              type: 'RateLimitError',
              value: providerError.message,
              mechanism: HANDLED,
              stacktrace: { frames: [PROVIDER_SDK_FRAME] },
            },
          ],
        },
      },
      { ...APPLICATION_HINT, originalException: providerError },
    )

    expect(sent?.exception?.values).toEqual([
      {
        type: 'RateLimitError',
        value: 'rate-limited',
        mechanism: HANDLED,
        stacktrace: { frames: [PROVIDER_SDK_FRAME] },
      },
    ])
    expect(sent?.tags).toEqual({ 'openwaggle.error_origin': 'provider-response' })
  })

  it('sends only the error events its own beforeSend scrubbed', async () => {
    const options = createSentryMainOptions(reporterInput(() => true))
    const transport = options.transport?.(
      fromPartial({ url: 'https://openwaggle.ai/api/v1/errors' }),
    )
    type SentEnvelope = Parameters<NonNullable<typeof transport>['send']>[0]
    const envelopeOf = (event: unknown): SentEnvelope => fromAny([{}, [[{ type: 'event' }, event]]])
    const scrubbed = await options.beforeSend?.(handledErrorEvent(), NO_HINT)

    expect(
      await transport?.send(fromAny([{}, [[{ type: 'session' }, { sid: 'session-id' }]]])),
    ).toEqual({})
    expect(await transport?.send(envelopeOf({ message: 'hand-made by a renderer' }))).toEqual({})
    expect(sentry.transportSend).not.toHaveBeenCalled()

    await transport?.send(envelopeOf(scrubbed))
    expect(sentry.makeElectronTransport).toHaveBeenCalledOnce()
    expect(sentry.transportSend).toHaveBeenCalledWith([{}, [[{ type: 'event' }, scrubbed]]])
  })
})
