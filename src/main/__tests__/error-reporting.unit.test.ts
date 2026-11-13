import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adapter,
  FIXED_OPT_OUT_SOURCES,
  loadErrorReporting,
  resetErrorReportingState,
  state,
  turnUsageStatistics,
} from './error-reporting.test-support'

describe('main-process error reporting', () => {
  beforeEach(() => {
    resetErrorReportingState()
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
      appRoot: '/tmp/openwaggle-app',
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
})
