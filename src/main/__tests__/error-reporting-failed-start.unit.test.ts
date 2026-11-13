import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adapter,
  lastKnown,
  loadErrorReporting,
  resetErrorReportingState,
  state,
} from './error-reporting.test-support'

describe('main-process error reporting of a failed start', () => {
  beforeEach(() => {
    resetErrorReportingState()
  })

  afterEach(() => {
    vi.useRealTimers()
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
