import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

async function resetStore() {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  const { resetSettingsStoreForTests } = await import('../settings')
  await resetSettingsStoreForTests()
}

async function loadSettingsModule() {
  const module = await import('../settings')
  await module.initializeSettingsStore()
  return module
}

describe('compaction threshold settings persistence', () => {
  beforeEach(async () => {
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-compaction-settings-'))
    await resetStore()
  })

  afterEach(async () => {
    const { disposeAppRuntime } = await import('../../runtime')
    await disposeAppRuntime()
    await fs.rm(state.userDataDir, { recursive: true, force: true })
  })

  it('falls back to 80 percent when the persisted value is invalid', async () => {
    const { runAppEffect } = await import('../../runtime')
    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${'compactionThresholdPercent'}, ${JSON.stringify(101)}, ${Date.now()})
        `
      }),
    )

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().compactionThresholdPercent).toBe(80)
  })

  it('roundtrips a valid global threshold', async () => {
    const {
      flushSettingsStoreForTests,
      getSettings,
      initializeSettingsStore,
      resetSettingsStoreForTests,
      updateSettings,
    } = await loadSettingsModule()

    updateSettings({ compactionThresholdPercent: 72 })
    await flushSettingsStoreForTests()
    await resetSettingsStoreForTests()
    await initializeSettingsStore()

    expect(getSettings().compactionThresholdPercent).toBe(72)
  })
})
