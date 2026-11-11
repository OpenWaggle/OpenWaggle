import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => {
  const state: { listener?: (settings: Settings | undefined) => void } = {}
  return state
})

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../store/authoritative-settings', () => ({
  onAuthoritativeSettingsChange: (listener: (settings: Settings | undefined) => void) => {
    store.listener = listener
    listener(undefined)
    return () => undefined
  },
}))

import {
  lastKnownSettingPath,
  recordLastKnownUsageStatisticsSetting,
  usageStatisticsSettingWithoutSettings,
} from '../usage-statistics-last-known-setting'

let userData = ''

function publish(usageStatisticsEnabled: boolean | undefined) {
  store.listener?.(
    usageStatisticsEnabled === undefined
      ? undefined
      : fromPartial<Settings>({ usageStatisticsEnabled }),
  )
}

async function savedFile() {
  return JSON.parse(await readFile(lastKnownSettingPath(userData), 'utf8'))
}

describe('last known Usage statistics Setting', () => {
  beforeEach(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'openwaggle-last-known-'))
  })
  afterEach(async () => {
    await rm(userData, { recursive: true, force: true })
  })

  it('saves the Setting each time the Session Host loads or changes it', async () => {
    recordLastKnownUsageStatisticsSetting(userData)
    publish(undefined)
    publish(false)
    await vi.waitFor(async () =>
      expect(await savedFile()).toEqual({ usageStatisticsEnabled: false }),
    )

    publish(true)
    await vi.waitFor(async () =>
      expect(await savedFile()).toEqual({ usageStatisticsEnabled: true }),
    )
    expect(usageStatisticsSettingWithoutSettings(userData)).toBe(true)
  })

  it('reads a saved off Setting as off, even on an install that has no store', async () => {
    await mkdir(path.dirname(lastKnownSettingPath(userData)), { recursive: true })
    await writeFile(lastKnownSettingPath(userData), '{"usageStatisticsEnabled":false}')

    expect(usageStatisticsSettingWithoutSettings(userData, () => false)).toBe(false)
  })

  it('uses the default on an install whose Session Host never kept a store', () => {
    expect(usageStatisticsSettingWithoutSettings(userData, () => false)).toBe(true)
  })

  it.each([['session-host/session-host.sqlite'], ['openwaggle.db']])(
    'is unknown without a saved Setting once %s exists',
    (storeFile) => {
      const existing = path.join(userData, storeFile)
      expect(usageStatisticsSettingWithoutSettings(userData, (target) => target === existing)).toBe(
        undefined,
      )
    },
  )

  it('treats a corrupt file on an install with a store as unknown', async () => {
    await mkdir(path.dirname(lastKnownSettingPath(userData)), { recursive: true })
    await writeFile(lastKnownSettingPath(userData), '{"usageStatisticsEnabled":"yes"}')

    expect(usageStatisticsSettingWithoutSettings(userData, () => true)).toBe(undefined)
  })
})
