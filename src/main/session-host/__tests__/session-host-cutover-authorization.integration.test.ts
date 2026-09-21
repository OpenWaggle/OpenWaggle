import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

it('keeps the migrated caller ceiling at yolo while preserving a null live override', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-auth-'))
  const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
  const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
  const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
  try {
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.prepare('UPDATE sessions SET authorization_mode_override = NULL').run()
      source
        .prepare(`UPDATE settings_store SET value_json = '"ask-for-approval"'
          WHERE key = 'defaultAuthorizationMode'`)
        .run()
    } finally {
      source.close()
    }

    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      expect(
        target
          .prepare(`
            SELECT session_execution_profiles.authorization_ceiling,
              sessions.authorization_mode_override
            FROM session_execution_profiles
            JOIN sessions ON sessions.id = session_execution_profiles.session_id
          `)
          .get(),
      ).toMatchObject({ authorization_ceiling: 'yolo', authorization_mode_override: null })
    } finally {
      target.close()
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  }
})
