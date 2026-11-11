import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErrorReporter } from '../ports/error-reporter'

type Enablement = { enabled: true } | { enabled: false; reason: string }

const state = vi.hoisted(() => {
  const listeners = new Set<(enabled: boolean) => void>()
  const initial: {
    enablement: Enablement
    listeners: Set<(enabled: boolean) => void>
    buildChannel: string
    env: Record<string, string | undefined>
    lastKnownSetting: boolean | undefined
  } = {
    enablement: { enabled: true },
    listeners,
    buildChannel: 'beta',
    env: {},
    lastKnownSetting: undefined,
  }
  return initial
})

/** The process environment and build that each fixed opt-out stands for. */
const FIXED_OPT_OUT_SOURCES: Readonly<
  Record<string, { buildChannel?: string; env?: Record<string, string> }>
> = {
  'dev-build': { buildChannel: 'dev' },
  automation: { env: { OPENWAGGLE_AUTOMATION: '1' } },
  'do-not-track': { env: { DO_NOT_TRACK: '1' } },
  'pi-telemetry': { env: { PI_TELEMETRY: '0' } },
  ci: { env: { CI: 'true' } },
}

const lastKnown = vi.hoisted(() => ({ record: vi.fn((_userData: string) => () => undefined) }))

const adapter = vi.hoisted(() => {
  const reporter = {
    captureException: vi.fn(),
    captureRendererEnvelope: vi.fn((_envelope: string) => undefined),
    flush: vi.fn(async (_timeout: number) => undefined),
  }
  return {
    reporter,
    startSentryMainErrorReporter: vi.fn((_input: unknown): ErrorReporter => reporter),
  }
})

vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return state.buildChannel
  },
  PRODUCT_NAME: 'OpenWaggle',
}))
vi.mock('../env', () => ({
  logLevel: 'info',
  get env() {
    return state.env
  },
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0-beta.4', getPath: () => 'C:\\Users\\me\\AppData\\OpenWaggle' },
}))
vi.mock('../usage-statistics/usage-statistics-last-known-setting', () => ({
  usageStatisticsSettingWithoutSettings: () => state.lastKnownSetting,
  recordLastKnownUsageStatisticsSetting: lastKnown.record,
}))
vi.mock('../adapters/electron/error-reporting/sentry-main-error-reporter', () => ({
  startSentryMainErrorReporter: adapter.startSentryMainErrorReporter,
}))
vi.mock('../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => state.enablement.enabled,
  currentUsageStatisticsEnablement: () => state.enablement,
  assumeUsageStatisticsSettingUntilSettingsLoad: (setting: boolean | undefined) => {
    if (setting === undefined) return
    state.enablement = setting ? { enabled: true } : { enabled: false, reason: 'setting' }
    for (const listener of [...state.listeners]) listener(setting)
  },
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
    state.lastKnownSetting = undefined
    state.listeners.clear()
    state.buildChannel = 'beta'
    state.env = {}
    process.getSystemVersion = () => '15.2'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['dev-build', 'automation', 'do-not-track', 'pi-telemetry', 'ci'])(
    'never loads the SDK or tells the renderer to start under the %s opt-out',
    async (reason) => {
      state.enablement = { enabled: false, reason }
      state.buildChannel = FIXED_OPT_OUT_SOURCES[reason]?.buildChannel ?? 'beta'
      state.env = { ...FIXED_OPT_OUT_SOURCES[reason]?.env }
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

  it('routes renderer envelopes to the reporter once reporting started, never before', async () => {
    const errorReporting = await loadErrorReporting()

    errorReporting.reportRendererEnvelope('before start')
    await errorReporting.startErrorReporting('gui')
    errorReporting.reportRendererEnvelope('after start')
    await errorReporting.flushErrorReporting()

    expect(adapter.reporter.captureRendererEnvelope.mock.calls).toEqual([['after start']])
  })

  it("drops renderer envelopes where the reporter takes renderer reports its own way (Electron's)", async () => {
    const { captureRendererEnvelope: _sdkBridge, ...electronReporter } = adapter.reporter
    adapter.startSentryMainErrorReporter.mockImplementationOnce(() => electronReporter)
    const errorReporting = await loadErrorReporting()
    await errorReporting.startErrorReporting('gui')

    expect(() => errorReporting.reportRendererEnvelope('ignored')).not.toThrow()
    await errorReporting.flushErrorReporting()
    expect(adapter.reporter.captureRendererEnvelope).not.toHaveBeenCalled()
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

  it('decides the switch from the fixed opt-outs alone, before Settings load or the SDK starts', async () => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    const errorReporting = await loadErrorReporting()

    // No start yet: the window opens before the Session Host answers (A-F2).
    expect(errorReporting.errorReportingRendererArguments()).toEqual([
      '--openwaggle-error-reporting',
    ])
    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
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

  it('reports a fatal startup error before exit as an application summary', async () => {
    const errorReporting = await loadErrorReporting()
    const error = Object.assign(new Error('bootstrap failed in C:\\Users\\me'), { code: 'EPERM' })

    await errorReporting.reportErrorBeforeExit(error, 'gui-bootstrap')

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    const [reported, origin] = adapter.reporter.captureException.mock.calls[0] ?? []
    expect(origin).toBe('application')
    expect(reported).toMatchObject({
      name: 'GuiBootstrapFailure',
      message: 'gui-bootstrap: Error code=EPERM',
    })
    expect(adapter.reporter.flush).toHaveBeenCalledOnce()
  })

  it('reports a startup failure when Settings never loaded but the Host last saved them on', async () => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    state.lastKnownSetting = true
    const errorReporting = await loadErrorReporting()

    await errorReporting.reportStartupFailure(new Error('timeout'), 'gui-session-host-start')

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(adapter.reporter.captureException).toHaveBeenCalledOnce())
  })

  it.each([
    ['no saved Setting on an install with a store', undefined],
    ['a saved Setting that is off', false],
  ])('sends nothing when Settings never loaded and there is %s', async (_case, saved) => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    state.lastKnownSetting = saved
    const errorReporting = await loadErrorReporting()

    await errorReporting.reportErrorBeforeExit(new Error('early failure'), 'gui-bootstrap')

    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
    expect(adapter.reporter.captureException).not.toHaveBeenCalled()
  })

  it('saves the Setting for later failed starts only in the Session Host, even under an opt-out', async () => {
    state.env = { DO_NOT_TRACK: '1' }
    state.enablement = { enabled: false, reason: 'do-not-track' }
    const host = await loadErrorReporting()
    await host.startErrorReporting('session-host')
    expect(lastKnown.record).toHaveBeenCalledWith('C:\\Users\\me\\AppData\\OpenWaggle')

    lastKnown.record.mockClear()
    const gui = await loadErrorReporting()
    await gui.startErrorReporting('gui')
    expect(lastKnown.record).not.toHaveBeenCalled()
  })

  it('never saves the Setting from a Session Host that failed before Settings loaded', async () => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    state.lastKnownSetting = true
    const host = await loadErrorReporting()

    await host.reportStartupFailure(new Error('no ownership'), 'session-host')
    await host.startErrorReporting('session-host')

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    expect(lastKnown.record).not.toHaveBeenCalled()
  })

  it('reports the fatal error of a Host whose Settings read failed, from the saved Setting', async () => {
    state.enablement = { enabled: false, reason: 'settings-unavailable' }
    state.lastKnownSetting = true
    const host = await loadErrorReporting()
    await host.startErrorReporting('session-host')
    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()

    void host.reportStartupFailure(new Error('settings not ready'), 'session-host')
    await host.flushErrorReporting()

    expect(adapter.startSentryMainErrorReporter).toHaveBeenCalledOnce()
    expect(adapter.reporter.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SessionHostFatalError' }),
      'application',
    )
  })

  it.each([
    ['a Host, Settings unreadable, saved off', 'session-host', 'settings-unavailable', false],
    ['a Host, Settings unreadable, none saved', 'session-host', 'settings-unavailable', null],
    ['a Host whose Settings loaded with statistics off', 'session-host', 'setting', true],
    ['a GUI whose Settings loaded with statistics off', 'gui', 'setting', true],
  ] as const)('sends nothing from %s', async (_case, processKind, reason, saved) => {
    state.enablement = { enabled: false, reason }
    state.lastKnownSetting = saved ?? undefined
    const errorReporting = await loadErrorReporting()
    await errorReporting.startErrorReporting(processKind)

    void errorReporting.reportStartupFailure(
      new Error('fatal'),
      processKind === 'gui' ? 'gui-session-host-start' : 'session-host',
    )
    await errorReporting.flushErrorReporting()

    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
    expect(adapter.reporter.captureException).not.toHaveBeenCalled()
  })

  it('never acts on a saved Setting under a fixed opt-out', async () => {
    state.env = { DO_NOT_TRACK: '1' }
    state.enablement = { enabled: false, reason: 'do-not-track' }
    state.lastKnownSetting = true
    const errorReporting = await loadErrorReporting()

    await errorReporting.reportStartupFailure(new Error('timeout'), 'session-host')

    expect(adapter.startSentryMainErrorReporter).not.toHaveBeenCalled()
  })

  it('waits no longer than its timeout before exit', async () => {
    vi.useFakeTimers()
    adapter.reporter.flush.mockImplementationOnce(() => new Promise<undefined>(() => {}))
    const errorReporting = await loadErrorReporting()
    await errorReporting.startErrorReporting('gui')

    const reported = errorReporting.reportErrorBeforeExit(
      new Error('fatal'),
      'gui-bootstrap',
      1_000,
    )
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(reported).resolves.toBeUndefined()
    expect(adapter.reporter.flush.mock.calls[0]?.[0]).toBeLessThanOrEqual(1_000)
  })
})
