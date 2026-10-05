import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Enablement = { enabled: true } | { enabled: false; reason: string }

const state = vi.hoisted(() => {
  const listeners = new Set<(enabled: boolean) => void>()
  const initial: { enablement: Enablement; listeners: Set<(enabled: boolean) => void> } = {
    enablement: { enabled: true },
    listeners,
  }
  return initial
})

const adapter = vi.hoisted(() => {
  const reporter = {
    captureException: vi.fn(),
    flush: vi.fn(async (_timeout: number) => undefined),
  }
  return { reporter, startSentryMainErrorReporter: vi.fn((_input: unknown) => reporter) }
})

vi.mock('@shared/build-identity-runtime', () => ({
  BUILD_CHANNEL: 'beta',
  PRODUCT_NAME: 'OpenWaggle',
}))
vi.mock('electron', () => ({ app: { getVersion: () => '1.0.0-beta.4' } }))
vi.mock('../adapters/error-reporting/sentry-main-error-reporter', () => ({
  startSentryMainErrorReporter: adapter.startSentryMainErrorReporter,
}))
vi.mock('../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => state.enablement.enabled,
  currentUsageStatisticsEnablement: () => state.enablement,
  onUsageStatisticsEnablementChange: (listener: (enabled: boolean) => void) => {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  },
}))

async function loadErrorReporting() {
  vi.resetModules()
  return import('../error-reporting')
}

function turnUsageStatistics(enabled: boolean) {
  state.enablement = enabled ? { enabled: true } : { enabled: false, reason: 'setting' }
  for (const listener of [...state.listeners]) listener(enabled)
}

describe('main-process error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.enablement = { enabled: true }
    state.listeners.clear()
    process.getSystemVersion = () => '15.2'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['dev-build', 'automation', 'do-not-track', 'pi-telemetry', 'ci'])(
    'never loads the SDK or tells the renderer to start under the %s opt-out',
    async (reason) => {
      state.enablement = { enabled: false, reason }
      const errorReporting = await loadErrorReporting()

      await errorReporting.startErrorReporting('gui')
      errorReporting.reportError(new Error('boom'))
      await errorReporting.flushErrorReporting()

      expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
      expect(state.listeners.size).toBe(0)
      expect(errorReporting.errorReportingRendererArguments()).toEqual([])
    },
  )

  it('starts once when Usage statistics are on and routes reports through the port', async () => {
    const errorReporting = await loadErrorReporting()
    const error = new Error('bootstrap failed')

    await Promise.all([
      errorReporting.startErrorReporting('gui'),
      errorReporting.startErrorReporting('gui'),
    ])
    errorReporting.reportError(error)
    errorReporting.reportError(error, 'tool-execution')
    await errorReporting.flushErrorReporting()

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledWith({
      process: 'gui',
      release: 'openwaggle@1.0.0-beta.4',
      environment: 'beta',
      homeDirectory: expect.any(String),
      temporaryDirectory: expect.any(String),
      isEnabled: expect.any(Function),
      operatingSystem: { name: expect.any(String), version: '15.2' },
      arch: process.arch,
    })
    expect(errorReporting.errorReportingRendererArguments()).toEqual([
      '--openwaggle-error-reporting',
    ])
    expect(adapter.reporter.captureException.mock.calls).toEqual([
      [error, undefined],
      [error, 'tool-execution'],
    ])
    expect(adapter.reporter.flush).toHaveBeenCalledWith(expect.any(Number))
  })

  it('loads nothing while the Setting is off, and starts once the user turns it on', async () => {
    state.enablement = { enabled: false, reason: 'setting' }
    const errorReporting = await loadErrorReporting()

    await errorReporting.startErrorReporting('session-host')
    errorReporting.reportError(new Error('dropped while off'))

    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
    // The window still gets the bridge, so its renderer can start once statistics are on.
    expect(errorReporting.errorReportingRendererArguments()).toEqual([
      '--openwaggle-error-reporting',
    ])

    turnUsageStatistics(true)
    await vi.waitFor(() => expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce())
    turnUsageStatistics(false)
    turnUsageStatistics(true)

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    expect(adapter.reporter.captureException).not.toHaveBeenCalled()
    expect(errorReporting.errorReportingRendererArguments()).toEqual([
      '--openwaggle-error-reporting',
    ])
  })

  it('gives the renderer no switch when the SDK failed to start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    adapter.startSentryMainErrorReporter.mockImplementationOnce(() => {
      throw new Error('init failed')
    })
    const errorReporting = await loadErrorReporting()

    await errorReporting.startErrorReporting('gui')

    expect(errorReporting.errorReportingRendererArguments()).toEqual([])
  })

  it('takes the switch back when the SDK fails to start after the user turned statistics on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    state.enablement = { enabled: false, reason: 'setting' }
    adapter.startSentryMainErrorReporter.mockImplementationOnce(() => {
      throw new Error('init failed')
    })
    const errorReporting = await loadErrorReporting()
    await errorReporting.startErrorReporting('gui')

    turnUsageStatistics(true)

    await vi.waitFor(() => expect(errorReporting.errorReportingRendererArguments()).toEqual([]))
  })

  it('reports a fatal error before exit when Settings loaded first', async () => {
    const errorReporting = await loadErrorReporting()
    const error = new Error('bootstrap failed')

    await errorReporting.reportErrorBeforeExit(error, 'gui')

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    expect(adapter.reporter.captureException).toHaveBeenCalledWith(error, undefined)
    expect(adapter.reporter.flush).toHaveBeenCalledOnce()
  })

  it('sends nothing before exit when Settings never loaded', async () => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    const errorReporting = await loadErrorReporting()

    await errorReporting.reportErrorBeforeExit(new Error('early failure'), 'gui')

    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
    expect(adapter.reporter.captureException).not.toHaveBeenCalled()
  })

  it('waits no longer than its timeout before exit', async () => {
    vi.useFakeTimers()
    adapter.reporter.flush.mockImplementationOnce(() => new Promise<undefined>(() => {}))
    const errorReporting = await loadErrorReporting()
    await errorReporting.startErrorReporting('gui')

    const reported = errorReporting.reportErrorBeforeExit(new Error('fatal'), 'gui', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(reported).resolves.toBeUndefined()
    expect(adapter.reporter.flush.mock.calls[0]?.[0]).toBeLessThanOrEqual(1_000)
  })
})
