import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host cutover execution-profile validation', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-thinking-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('accepts a durable max thinking profile on every startup', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    const target = new DatabaseSync(targetDatabasePath)
    try {
      target
        .prepare(`UPDATE session_execution_profiles SET profile_json = ?`)
        .run('{"modelId":"openai/gpt-5.4","thinkingLevel":"max"}')
    } finally {
      target.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'already-complete' })
  })
})
