import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { openHostSqliteDatabase } from '../host-sqlite-database'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

it('keeps the migrated caller ceiling at yolo while preserving a null live override', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-auth-'))
  const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
  const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
  const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
  try {
    seedLegacyDatabase(sourceDatabasePath)
    const source = openHostSqliteDatabase(sourceDatabasePath)
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
    const target = openHostSqliteDatabase(targetDatabasePath, { readonly: true })
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
