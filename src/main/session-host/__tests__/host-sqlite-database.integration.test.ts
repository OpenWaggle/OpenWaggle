import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSafeChildEnv } from '../../env'
import { type HostSqliteDatabase, openHostSqliteDatabase } from '../host-sqlite-database'

const execFileAsync = promisify(execFile)
const betterSqlitePath = createRequire(import.meta.url).resolve('better-sqlite3')

/** Another process, as a second Host or a CLI would be, trying to start a write. */
const WRITER_PROBE = `
  const Database = require(process.argv[1])
  const database = new Database(process.argv[2], { timeout: 0 })
  try {
    database.exec('BEGIN IMMEDIATE')
    database.exec('ROLLBACK')
    process.stdout.write('acquired')
  } catch (error) {
    process.stdout.write(String(error.code))
  } finally {
    database.close()
  }
`

async function otherProcessWriteLock(databasePath: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['-e', WRITER_PROBE, betterSqlitePath, databasePath],
    { env: getSafeChildEnv() },
  )
  return stdout
}

describe('Host SQLite connections', () => {
  let temporaryRoot = ''
  const open: HostSqliteDatabase[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-sqlite-'))
  })

  afterEach(async () => {
    for (const database of open.splice(0)) if (database.open) database.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it("keeps the Host connection's write lock when another connection in its process closes", async () => {
    const databasePath = path.join(temporaryRoot, 'session-host.sqlite')
    const host = openHostSqliteDatabase(databasePath)
    open.push(host)
    host.exec('PRAGMA journal_mode = WAL; CREATE TABLE session_runs (id TEXT)')
    host.exec("BEGIN IMMEDIATE; INSERT INTO session_runs VALUES ('run-1')")
    await expect(otherProcessWriteLock(databasePath)).resolves.toBe('SQLITE_BUSY')

    // What the upgrade-blocker check and the cutover do next to the Host's connection. With a
    // second SQLite library, this close released the Host's lock and the probe acquired it (#371).
    const reader = openHostSqliteDatabase(databasePath, { readonly: true })
    reader.prepare('SELECT COUNT(*) AS count FROM session_runs').get()
    reader.close()

    await expect(otherProcessWriteLock(databasePath)).resolves.toBe('SQLITE_BUSY')
    host.exec('COMMIT')
    await expect(otherProcessWriteLock(databasePath)).resolves.toBe('acquired')
  })
})
