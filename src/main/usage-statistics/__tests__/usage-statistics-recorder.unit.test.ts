import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const listeners = new Set<(enabled: boolean) => void>()
  const warnings: { readonly message: string; readonly data: unknown }[] = []
  return { enabled: true, reason: 'setting', listeners, warnings }
})

vi.mock('../usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => harness.enabled,
  currentUsageStatisticsEnablement: () =>
    harness.enabled ? { enabled: true } : { enabled: false, reason: harness.reason },
  onUsageStatisticsEnablementChange: (listener: (enabled: boolean) => void) => {
    harness.listeners.add(listener)
    return () => harness.listeners.delete(listener)
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (message: string, data: unknown) => harness.warnings.push({ message, data }),
    error: vi.fn(),
  }),
}))

import {
  configureUsageStatisticsGuiRecorder,
  configureUsageStatisticsHostRecorder,
  flushUsageStatistics,
  flushUsageStatisticsSync,
  recordUsageStatistics,
  resetUsageStatisticsRecorderForTests,
  USAGE_STATISTICS_DIRECTORY_NAME,
  usageStatisticsHostRecorder,
} from '../usage-statistics-recorder'
import {
  decodeUsageStatisticsGuiSpool,
  decodeUsageStatisticsHostState,
} from '../usage-statistics-state-schema'

const NOW = Date.parse('2026-10-01T10:00:00.000Z')
const DAY = '2026-10-01'

function setEnabled(enabled: boolean, reason = 'setting') {
  harness.enabled = enabled
  harness.reason = reason
  for (const listener of [...harness.listeners]) listener(enabled)
}

let userData = ''
const statisticsDirectory = () => path.join(userData, USAGE_STATISTICS_DIRECTORY_NAME)

async function readHostFile() {
  const raw = await readFile(path.join(statisticsDirectory(), 'host-state.json'), 'utf8')
  return decodeUsageStatisticsHostState(JSON.parse(raw))
}

async function readGuiFile() {
  const raw = await readFile(path.join(statisticsDirectory(), 'gui-observations.json'), 'utf8')
  return decodeUsageStatisticsGuiSpool(JSON.parse(raw))
}

function configureHost(appVersion = '1.0.0') {
  configureUsageStatisticsHostRecorder({ userDataDirectory: userData, appVersion, now: () => NOW })
}

describe('Usage statistics recorder', () => {
  beforeEach(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'openwaggle-usage-statistics-'))
    harness.enabled = true
    harness.reason = 'setting'
    harness.listeners.clear()
    harness.warnings.length = 0
  })

  afterEach(async () => {
    await resetUsageStatisticsRecorderForTests()
    await rm(userData, { recursive: true, force: true })
  })

  it('records nothing in a process without a recorder', () => {
    expect(() => recordUsageStatistics({ kind: 'app-opened' })).not.toThrow()
    expect(usageStatisticsHostRecorder()).toBeNull()
  })

  it('starts the Install and records Session Host observations for today', async () => {
    configureHost()
    recordUsageStatistics({ kind: 'run-started', entryPoint: 'cli' })
    recordUsageStatistics({ kind: 'feature', flag: 'worktree' })
    await flushUsageStatistics()

    const state = await readHostFile()
    expect(state.install).toMatchObject({ firstSeenDay: DAY, lastLaunchedVersion: '1.0.0' })
    expect(state.days[DAY]).toMatchObject({
      ranRun: true,
      entryPoints: ['cli'],
      features: ['worktree'],
    })
  })

  it('turns a launch of a higher version into update.installed', async () => {
    configureHost('1.0.0-beta.4')
    await resetUsageStatisticsRecorderForTests()
    configureHost('1.0.0-rc.1')
    await flushUsageStatistics()

    const state = await readHostFile()
    expect(state.days[DAY]?.updates).toEqual(['1.0.0-beta.4'])
    expect(state.install.lastLaunchedVersion).toBe('1.0.0-rc.1')
  })

  it('does not count a downgrade or a switch to an older channel build as an update', async () => {
    for (const [previous, current] of [
      ['1.1.0', '1.0.0'],
      ['1.0.0-beta.4', '1.0.0-alpha.9'],
    ] as const) {
      configureHost(previous)
      await resetUsageStatisticsRecorderForTests()
      configureHost(current)
      await resetUsageStatisticsRecorderForTests()

      const state = await readHostFile()
      expect(state.days[DAY]?.updates ?? []).toEqual([])
      expect(state.install.lastLaunchedVersion).toBe(current)
    }
  })

  it('records no update.installed after a dev or test build, whose version cannot be sent', async () => {
    for (const previous of ['1.0.0-dev.3', '0.0.0-test']) {
      configureHost(previous)
      await resetUsageStatisticsRecorderForTests()
      configureHost('1.0.0')
      await resetUsageStatisticsRecorderForTests()

      const state = await readHostFile()
      expect(state.days[DAY]?.updates ?? []).toEqual([])
      expect(state.install.lastLaunchedVersion).toBe('1.0.0')
    }
  })

  it('does not rewrite its file for an observation that changes nothing', async () => {
    configureHost()
    recordUsageStatistics({ kind: 'feature', flag: 'terminal' })
    await flushUsageStatistics()
    await rm(path.join(statisticsDirectory(), 'host-state.json'))

    recordUsageStatistics({ kind: 'feature', flag: 'terminal' })
    await flushUsageStatistics()

    await expect(stat(path.join(statisticsDirectory(), 'host-state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('records nothing while off and clears the queue when turned off, keeping Install markers', async () => {
    configureHost()
    recordUsageStatistics({ kind: 'run-started', entryPoint: 'app' })
    setEnabled(false)
    recordUsageStatistics({ kind: 'app-opened' })
    await flushUsageStatistics()

    const state = await readHostFile()
    expect(state.days).toEqual({})
    expect(state.install).toMatchObject({ firstSeenDay: DAY, lastLaunchedVersion: null })
  })

  it('clears a queue left from before when the Session Host starts with statistics off', async () => {
    configureHost()
    recordUsageStatistics({ kind: 'run-started', entryPoint: 'app' })
    await resetUsageStatisticsRecorderForTests()
    harness.enabled = false
    harness.reason = 'do-not-track'

    configureHost()
    await flushUsageStatistics()

    expect((await readHostFile()).days).toEqual({})
  })

  it('keeps the queue while Settings are not loaded yet', async () => {
    configureHost()
    recordUsageStatistics({ kind: 'run-started', entryPoint: 'app' })
    await resetUsageStatisticsRecorderForTests()
    harness.enabled = false
    harness.reason = 'settings-unavailable'

    configureHost()
    await flushUsageStatistics()

    expect((await readHostFile()).days[DAY]?.ranRun).toBe(true)
  })

  it('resets corrupt state conservatively with a structured log instead of failing', async () => {
    await mkdir(statisticsDirectory(), { recursive: true })
    await writeFile(path.join(statisticsDirectory(), 'host-state.json'), '{"schemaVersion":9')

    configureHost()
    await flushUsageStatistics()

    expect(harness.warnings).toEqual([
      expect.objectContaining({
        message: 'Usage statistics state is corrupt; starting again',
        data: expect.objectContaining({ file: 'host-state.json' }),
      }),
    ])
    const state = await readHostFile()
    // Nothing lost can be told apart from what was sent: no history or one-time event again.
    expect(state.reporting.closedThroughDay).toBe('2026-09-30')
    expect(state.install).toMatchObject({
      firstSeenDay: DAY,
      evidenceChecked: false,
      newReported: true,
      onboardingReported: true,
    })
  })

  it('keeps GUI observations in the GUI file and clears it when statistics are turned off', async () => {
    configureUsageStatisticsGuiRecorder({ userDataDirectory: userData, now: () => NOW })
    recordUsageStatistics({ kind: 'app-opened' })
    recordUsageStatistics({ kind: 'feature', flag: 'terminal' })
    await flushUsageStatistics()

    expect((await readGuiFile()).days[DAY]).toMatchObject({ appOpened: 1, features: ['terminal'] })
    expect(usageStatisticsHostRecorder()).toBeNull()

    setEnabled(false)
    await flushUsageStatistics()
    expect((await readGuiFile()).days).toEqual({})
  })

  it('saves GUI observations synchronously when the app quits', async () => {
    configureUsageStatisticsGuiRecorder({ userDataDirectory: userData, now: () => NOW })
    recordUsageStatistics({ kind: 'feature', flag: 'voice' })

    flushUsageStatisticsSync()

    expect((await readGuiFile()).days[DAY]).toMatchObject({ features: ['voice'] })
  })
})
