/**
 * The mocked environment of the main-process error reporting tests: the build, the process
 * environment, the Usage statistics switch, the last saved Setting and the Sentry adapter, each a
 * hoisted value a test sets before it loads a fresh `error-reporting` module.
 */
import type { ErrorReporter } from '../ports/error-reporter'
import { vi } from 'vitest'

type Enablement = { enabled: true } | { enabled: false; reason: string }

export const state = (() => {
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
})()

/** The process environment and build that each fixed opt-out stands for. */
export const FIXED_OPT_OUT_SOURCES: Readonly<
  Record<string, { buildChannel?: string; env?: Record<string, string> }>
> = {
  'dev-build': { buildChannel: 'dev' },
  automation: { env: { OPENWAGGLE_AUTOMATION: '1' } },
  'do-not-track': { env: { DO_NOT_TRACK: '1' } },
  'pi-telemetry': { env: { PI_TELEMETRY: '0' } },
  ci: { env: { CI: 'true' } },
}

export const lastKnown = { record: vi.fn((_userData: string) => () => undefined) }

export const adapter = (() => {
  const reporter = {
    captureException: vi.fn<ErrorReporter['captureException']>(),
    captureRendererEnvelope: vi.fn((_envelope: string) => undefined),
    flush: vi.fn(async (_timeout: number) => undefined),
  }
  return {
    reporter,
    startSentryMainErrorReporter: vi.fn<(input: unknown) => ErrorReporter>(() => reporter),
  }
})()

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
vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    version: () => '1.0.0-beta.4',
  }),
}))
vi.mock('../desktop-shell/app-paths', async () => ({
  appPaths: (await import('../test-support/fake-desktop-shell')).fakeAppPaths(
    'C:\\Users\\me\\AppData\\OpenWaggle',
  ),
}))
vi.mock('../system-version', () => ({ systemVersion: () => '15.2' }))
vi.mock('../usage-statistics/usage-statistics-last-known-setting', () => ({
  usageStatisticsSettingWithoutSettings: () => state.lastKnownSetting,
  recordLastKnownUsageStatisticsSetting: lastKnown.record,
}))
vi.mock('../adapters/electrobun/error-reporting/sentry-bun-error-reporter', () => ({
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

export async function loadErrorReporting() {
  vi.resetModules()
  return import('../error-reporting')
}

export function turnUsageStatistics(enabled: boolean) {
  state.enablement = enabled ? { enabled: true } : { enabled: false, reason: 'setting' }
  for (const listener of [...state.listeners]) listener(enabled)
}

/** Puts every mocked value back to an enabled beta build with no saved Setting. */
export function resetErrorReportingState() {
  vi.clearAllMocks()
  state.enablement = { enabled: true }
  state.lastKnownSetting = undefined
  state.listeners.clear()
  state.buildChannel = 'beta'
  state.env = {}
}
