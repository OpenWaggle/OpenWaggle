import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const initial: { buildChannel: string } = { buildChannel: 'beta' }
  return initial
})

vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return state.buildChannel
  },
  PRODUCT_NAME: 'OpenWaggle',
}))

const RENDERER_LOCATION = { protocol: 'openwaggle:' }

async function loadErrorReporting() {
  vi.resetModules()
  return import('../error-reporting')
}

function rendererReporter() {
  const reporter = { captureException: vi.fn() }
  return {
    reporter,
    load: vi.fn(async () => ({ startSentryRendererErrorReporter: () => reporter })),
  }
}

/** This window's Usage statistics Setting, which the test turns on and off. */
function usageStatisticsSetting(initiallyEnabled: boolean) {
  let enabled = initiallyEnabled
  const listeners = new Set<() => void>()
  return {
    setting: {
      isEnabled: () => enabled,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    listeners,
    turn(next: boolean) {
      enabled = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const ENABLED = usageStatisticsSetting(true).setting

/** A scheduler that holds the start until the test runs it, like an idle callback. */
function heldSchedule() {
  const starts: (() => void)[] = []
  return {
    schedule: (start: () => void) => {
      starts.push(start)
    },
    runIdle: () => {
      for (const start of starts.splice(0)) start()
    },
  }
}

describe('renderer error reporting', () => {
  beforeEach(() => {
    state.buildChannel = 'beta'
    vi.stubGlobal('window', { location: RENDERER_LOCATION, __SENTRY_IPC__: { 'sentry-ipc': {} } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never loads the SDK without the preload bridge', async () => {
    vi.stubGlobal('window', { location: RENDERER_LOCATION })
    const { reportRendererError, scheduleRendererErrorReporting } = await loadErrorReporting()
    const { load } = rendererReporter()
    const idle = heldSchedule()

    scheduleRendererErrorReporting(ENABLED, idle.schedule, load)
    idle.runIdle()
    reportRendererError(new Error('nowhere to go'))

    expect(load).not.toHaveBeenCalled()
  })

  it('never loads the SDK in a Dev build', async () => {
    state.buildChannel = 'dev'
    const { scheduleRendererErrorReporting } = await loadErrorReporting()
    const { load } = rendererReporter()
    const idle = heldSchedule()

    scheduleRendererErrorReporting(ENABLED, idle.schedule, load)
    idle.runIdle()

    expect(load).not.toHaveBeenCalled()
  })

  it('loads the SDK only once the renderer is idle, and reports errors held until then', async () => {
    const { reportRendererError, scheduleRendererErrorReporting } = await loadErrorReporting()
    const { load, reporter } = rendererReporter()
    const idle = heldSchedule()
    const early = new Error('render failed early')
    const later = new Error('render failed later')

    reportRendererError(new Error('before scheduling is dropped'))
    scheduleRendererErrorReporting(ENABLED, idle.schedule, load)
    scheduleRendererErrorReporting(ENABLED, idle.schedule, load)
    reportRendererError(early)

    expect(load).not.toHaveBeenCalled()
    idle.runIdle()
    await vi.waitFor(() => expect(reporter.captureException).toHaveBeenCalledWith(early))
    reportRendererError(later)

    expect(load).toHaveBeenCalledOnce()
    expect(reporter.captureException.mock.calls).toEqual([[early], [later]])
  })

  it('waits while Usage statistics are off and starts once the user turns them on', async () => {
    const { reportRendererError, scheduleRendererErrorReporting } = await loadErrorReporting()
    const { load, reporter } = rendererReporter()
    const idle = heldSchedule()
    const usageStatistics = usageStatisticsSetting(false)
    const afterEnabling = new Error('render failed once statistics were on')

    scheduleRendererErrorReporting(usageStatistics.setting, idle.schedule, load)
    reportRendererError(new Error('dropped while statistics are off'))
    idle.runIdle()
    usageStatistics.turn(false)

    expect(load).not.toHaveBeenCalled()
    usageStatistics.turn(true)
    reportRendererError(afterEnabling)
    idle.runIdle()
    await vi.waitFor(() => expect(reporter.captureException).toHaveBeenCalledWith(afterEnabling))
    usageStatistics.turn(true)

    expect(load).toHaveBeenCalledOnce()
    expect(usageStatistics.listeners.size).toBe(0)
    expect(reporter.captureException.mock.calls).toEqual([[afterEnabling]])
  })

  it('stays off when the SDK chunk cannot load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { reportRendererError, scheduleRendererErrorReporting } = await loadErrorReporting()
    const idle = heldSchedule()
    const load = vi.fn(async () => {
      throw new Error('chunk missing')
    })

    scheduleRendererErrorReporting(ENABLED, idle.schedule, load)
    idle.runIdle()
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())

    expect(() => reportRendererError(new Error('ignored'))).not.toThrow()
  })
})
