import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
  processExitIntegration,
  type SentryMainErrorReporterInput,
  startSentryMainErrorReporter,
} from '../sentry-main-error-reporter'

const HANDLED = { type: 'generic', handled: true }

function reporterInput(): SentryMainErrorReporterInput {
  return {
    process: 'gui',
    release: 'openwaggle@1.0.0-beta.4',
    environment: 'beta',
    homeDirectory: '/Users/alice',
    temporaryDirectory: '/var/folders/73/abc123/T',
    isEnabled: () => true,
    operatingSystem: { name: 'macOS', version: '15.2' },
    arch: 'arm64',
  }
}

describe('process exit integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports an abnormal end of an Electron helper or renderer by type and reason only', () => {
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

/** The SDK's own channel naming, so an SDK upgrade that renames the scope channel fails here. */
async function sdkScopeChannel() {
  const ipcModule: unknown = await import(
    pathToFileURL(path.resolve('node_modules/@sentry/electron/esm/common/ipc.js')).href
  )
  const channels: unknown =
    typeof ipcModule === 'object' && ipcModule !== null
      ? Reflect.get(ipcModule, 'ipcChannelUtils')
      : undefined
  if (typeof channels !== 'function') throw new Error('The SDK moved its IPC channel naming')
  const utils: unknown = Reflect.apply(channels, undefined, ['sentry-ipc'])
  const createKey: unknown =
    typeof utils === 'object' && utils !== null ? Reflect.get(utils, 'createKey') : undefined
  if (typeof createKey !== 'function') throw new Error('The SDK moved its IPC channel naming')
  return Reflect.apply(createKey, undefined, ['scope'])
}

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
    // No renderer may change this process's scope over the SDK's IPC bridge.
    expect(electron.ipcMain.removeAllListeners).toHaveBeenCalledWith(await sdkScopeChannel())
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

  it('stops waiting for pending reports once the timeout passes', async () => {
    vi.useFakeTimers()
    sentry.flush.mockImplementationOnce(() => new Promise<boolean>(() => {}))
    const reporter = startSentryMainErrorReporter(reporterInput())

    const flushed = reporter.flush(2_000)
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(flushed).resolves.toBeUndefined()
  })
})
